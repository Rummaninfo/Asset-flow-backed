const express = require("express");
const app = express();
let cors = require("cors");
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://assetsflow-ec37a.web.app",
      "https://api.imgbb.com/1/upload?key=5df8891d2b739bdfbe849cb2e09fab7e",
    ],
    credentials: true,
  })
);
app.use(express.json());

require("dotenv").config();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@crud.p5kddzk.mongodb.net/?retryWrites=true&w=majority`;
// stripe

const admin = require("firebase-admin");

const decoded = Buffer.from(
  process.env.FIREBASE_SERVICE_KEY,
  "base64"
).toString("utf8");
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

let verifyToken = async (req, res, next) => {
  let token = req.headers.authorization;
  console.log("token", token);
  if (!token) {
    return res.status(401).send({ message: "unauthorized token" });
  }

  try {
    let idToken = token.split(" ")[1];
    let decoded = await admin.auth().verifyIdToken(idToken);
    // console.log("decoded ", decoded);
    req.decoded_email = decoded.email;
    // console.log('decodec email' , req.decoded_email)
    next();
  } catch (er) {
    console.log(er);
    return res.status(401).send({ message: "unauthorized access" });
  }
};

const stripe = require("stripe")(process.env.STRIPE);

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
app.get("/", (req, res) => {
  res.send("Hello World!");
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)

    try {
      let db = client.db("asset-flow");
      let register = db.collection("register");
      let assetsCollection = db.collection("assets");
      let requestsCollection = db.collection("requestCollection");
      let assignedAssetsCollection = db.collection("assignedAssets");
      let employeeAffiliationsCollection = db.collection("employeeAffiliation");
      let Packages = db.collection("Packages");

      // middle ware
      let verifyHr = async (req, res, next) => {
        let email = req.decoded_email;
        let query = { email };
        let user = await register.findOne(query);
        if (!user || user.role !== "hr") {
          return res.status(403).send({ message: "forbiden access" });
        }

        next();
      };

      //  allemplooye
      app.get("/employee/:email", async (req, res) => {
        let email = req.params.email;
        console.log(email);
        let filter = { hrEmail: email };
        let result = await employeeAffiliationsCollection
          .find(filter)
          .toArray();
        res.send(result);
      });

      app.patch("/requests/:id", async (req, res) => {
        try {
          const id = req.params.id;
          const { status, processedBy } = req.body; // HR email নিন

          if (!status) {
            return res.status(400).send({
              success: false,
              message: "Status is required",
            });
          }

          // 1️⃣ Request খুঁজুন
          const request = await requestsCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!request) {
            return res.status(404).send({
              success: false,
              message: "Request not found",
            });
          }

          // Request ইতিমধ্যে processed হলে
          if (request.status !== "pending") {
            return res.status(400).send({
              success: false,
              message: `Request is already ${request.requestStatus}`,
            });
          }

          // 2️⃣ APPROVED হলে
          if (status === "approved") {
            // ✅ Stock availability check
            const asset = await assetsCollection.findOne({
              _id: new ObjectId(request.assetId),
            });

            if (!asset) {
              return res.status(404).send({
                success: false,
                message: "Asset not found",
              });
            }

            const hr = await register.findOne({
              email: request.hrEmail,
              role: "hr",
            });

            if (!hr) {
              return res.status(404).send({
                success: false,
                message: "HR not found",
              });
            }

            if (hr.currentEmployees >= hr.packageLimit) {
              return res.status(403).send({
                success: false,
                message: "Package limit reached. Please upgrade your package.",
              });
            }

            if (asset.availableQuantity < 1) {
              return res.status(400).send({
                success: false,
                message: "Asset is out of stock",
              });
            }

            // ✅ Asset quantity কমান (1 টি)
            await assetsCollection.updateOne(
              { _id: new ObjectId(request.assetId) },

              { $inc: { availableQuantity: -1 } } // ✅ 1 কমাবেন
            );

            // ✅ Employee affiliation
            let existingAffiliation =
              await employeeAffiliationsCollection.findOne({
                employeeEmail: request.requesterEmail,
                companyName: request.companyName,
              });

            const employeeUser = await register.findOne({
              email: request.requesterEmail,
              role: "employee",
            })
            console.log('ami emoployeee', employeeUser)

            if (!existingAffiliation) {
              await employeeAffiliationsCollection.insertOne({
                employeeEmail: request.requesterEmail,
                employeeName: request.requesterName,
                employeeBirthDate: employeeUser.dateOfBirth,  
                hrEmail: request.hrEmail,
                companyName: request.companyName,
                affiliationDate: new Date(),
                status: "active",
              });

              // ✅ HR employee count update
              await register.updateOne(
                { email: request.hrEmail, role: "hr" },
                { $inc: { currentEmployees: 1 } }
              );
            }

            // ✅ Assigned assets এ যোগ করুন
            await assignedAssetsCollection.insertOne({
              assetId: new ObjectId(request.assetId),
              assetName: request.assetName,
              assetImage: request.assetImage || asset.productImage, // Asset থেকে নিন
              assetType: request.assetType || asset.productType, // Asset থেকে নিন
              employeeEmail: request.requesterEmail,
              employeeName: request.requesterName,
              hrEmail: request.hrEmail,
              companyName: request.companyName,
              assignmentDate: new Date(),
              returnDate: null,
              status: "assigned",
            });
          }

          // 3️⃣ Request status update (একটু আপডেটেড)
          const result = await requestsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                status: status,
                approvalDate: status === "approved" ? new Date() : null, // ✅ যোগ করুন
                processedBy: processedBy || request.hrEmail, // ✅ কে করলো
                decisionDate: new Date(),
              },
            }
          );
          // if(status === "approved"){

          // }

          res.send({
            success: true,
            modifiedCount: result.modifiedCount,
            message: `Request ${status} successfully`,
          });
        } catch (error) {
          console.error("Error updating request:", error);
          res.status(500).send({
            success: false,
            message: "Internal server error",
          });
        }
      });

      // payment update packages
      app.patch("/payment-success", async (req, res) => {
        let sessionId = req.query.session_id;
        // console.log("sessionId", sessionId)
        let session = await stripe.checkout.sessions.retrieve(sessionId);
        console.log("session retirve", session);
        if (session.payment_status === "paid") {
          let id = session.metadata.packageId;
          // let query = { _id: new ObjectId(id) };
          let query = { email: session.customer_email };

          let packageName = session.metadata.packageName;
          let packageLimit = 5;
          if (packageName === "Standard") packageLimit = 10;
          if (packageName === "Premium") packageLimit = 20;

          await register.updateOne(query, {
            $set: {
              subscription: packageName,
              packageLimit: packageLimit,
            },
          });
        }

        res.send({ success: true, message: "Package upgraded successfully" });
      });

      // register post
      app.post("/register", async (req, res) => {
        console.log(req.body);
        let data = req.body;
        let result = await register.insertOne(data);
        res.send({ message: true, result });
      });

      app.post("/add-asset", verifyToken, verifyHr, async (req, res) => {
        const assetData = req.body;
        assetData.dateAdded = new Date();
        const result = await assetsCollection.insertOne(assetData);
        res.send({
          success: true,
          result,
        });
      });
      app.post("/asset-requests", async (req, res) => {
        let requestData = req.body;
        requestData.requestDate = new Date();
        requestData.status = "pending";
        const result = await requestsCollection.insertOne(requestData);
        res.send(result);
      });

      // payment realed apis

      app.post("/create-checkout-session", async (req, res) => {
        console.log(req.body);
        try {
          const paymentinfo = req.body;
          console.log(paymentinfo, "infor");

          const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            mode: "payment",

            line_items: [
              {
                price_data: {
                  currency: "usd",
                  unit_amount: paymentinfo.amount * 120, // 🔥 8 USD → 800
                  product_data: {
                    name: "Service Payment",
                    description: "One-time payment",
                  },
                },
                quantity: 1,
              },
            ],

            // যদি hrEmail ইমেইল হয়
            customer_email: paymentinfo.hrEmail,

            metadata: {
              packageId: paymentinfo.packageId.toString(),
              packageName: paymentinfo.packageName,
            },

            success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel?session_id={CHECKOUT_SESSION_ID}`,
          });

          res.send({ url: session.url });
        } catch (error) {
          console.error("Stripe Checkout Error:", error);
          res.status(500).send({ error: "Checkout session তৈরি করা যায়নি" });
        }
      });

      // user get
      app.get("/user/:email/role", async (req, res) => {
        let email = req.params.email;
        let query = { email };
        console.log(query);
        let user = await register.findOne(query);
        res.send(user?.role || "user");
      });
      // eta fix korshi lagle boilo
      app.get("/user/:email", async (req, res) => {
        let email = req.params.email;
        let query = { email: email };
        let result = await register.findOne(query);
        res.send(result);
      });

      // assets get
      app.get("/assets-list/:email", verifyToken, async (req, res) => {
        let email = req.params.email;
        let query = { hrEmail: email };
        let result = await assetsCollection.find(query).toArray();
        res.send(result);
      });

      // request data get
      app.get("/my-requests/:email", async (req, res) => {
        const email = req.params.email;

        const result = await requestsCollection
          .find({ requesterEmail: email })
          .toArray();

        res.send(result);
      });

      app.get("/hr/employees/:hrEmail", async (req, res) => {
        const hrEmail = req.params.hrEmail;

        const employees = await employeeAffiliationsCollection
          .find({ hrEmail })
          .toArray();

        const employeesWithAssets = await Promise.all(
          employees.map(async (emp) => {
            const count = await assignedAssetsCollection.countDocuments({
              employeeEmail: emp.employeeEmail,
              status: "assigned",
            });

            return { ...emp, assets: count };
          })
        );

        res.send({ employees: employeesWithAssets });
      });

      // my team
      app.get("/my-team/:companyName", async (req, res) => {
        console.log("accesstoken", req.headers);
        const companyName = req.params.companyName;

        try {
          const employees = await register
            .find({
              role: "employee",
              companyName: companyName,
            })
            .toArray();

          res.json(employees);
        } catch (error) {
          res.status(500).json({ error: "Server error" });
        }
      });

      app.get("/hr-requests/:hrEmail", async (req, res) => {
        try {
          const hrEmail = req.params.hrEmail;

          // HR এর সব request আনবে
          const requests = await requestsCollection
            .find({ hrEmail })
            .sort({ requestDate: -1 }) // latest first
            .toArray();

          res.send(requests);
        } catch (error) {
          console.error("HR Requests Error:", error);
          res.status(500).send([]);
        }
      });

      // employee list

      // app.get("/my-companies/:employeEmail", async (req, res) => {
      //   const employeeEmail = req.params.employeeEmail
      //   let filet = { employeeEmail: employeeEmail }

      //   let companies = await employeeAffiliationsCollection
      //     .find(filet)
      //     .toArray();
      //   res.send(companies);
      // });

      app.get("/my-companies/:employeeEmail", async (req, res) => {
        try {
          const employeeEmail = req.params.employeeEmail;

          const companies = await employeeAffiliationsCollection
            .find({ employeeEmail })
            .toArray();

          res.send({
            success: true,
            companies,
          });
        } catch (error) {
          res.status(500).send({
            success: false,
            companies: [],
          });
        }
      });

      app.get("/company-team/:companyName", async (req, res) => {
        try {
          const companyName = req.params.companyName;

          const teamMembers = await employeeAffiliationsCollection
            .find({
              companyName: { $regex: `^${companyName}$`, $options: "i" },
            })
            .toArray();

          res.send({
            success: true,
            teamMembers,
          });
        } catch (error) {
          res.status(500).send({
            success: false,
            teamMembers: [],
          });
        }
      });
      app.get("/employee-assets", verifyToken, async (req, res) => {
        const assets = await assetsCollection
          .find({ availableQuantity: { $gt: 0 } })
          .toArray();

        res.send(assets);
      });

      app.get("/packages", async (req, res) => {
        // console.log(req.headers)
        let result = await Packages.find().toArray();
        res.send(result);
      });

      app.delete("/employee/:id", verifyToken, verifyHr, async (req, res) => {
        try {
          const id = req.params.id;

          // 1️⃣ আগে affiliation আনতে হবে
          const affiliation = await employeeAffiliationsCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!affiliation) {
            return res.status(404).send({
              success: false,
              message: "Affiliation not found",
            });
          }

          // 2️⃣ affiliation delete
          const result = await employeeAffiliationsCollection.deleteOne({
            _id: new ObjectId(id),
          });

          // 3️⃣ HR currentEmployees কমাও
          await register.updateOne(
            { email: affiliation.hrEmail, role: "hr" },
            { $inc: { currentEmployees: -1 } }
          );

          res.send({
            success: true,
            message: "Employee removed",
            result,
          });
        } catch (error) {
          console.error(error);
          res.status(500).send({ success: false });
        }
      });

      app.delete("/assetlist/:id", verifyToken, verifyHr, async (req, res) => {
        let id = req.params.id;
        let filter = { _id: new ObjectId(id) };
        console.log(filter);
        let result = await assetsCollection.deleteOne(filter);
        res.send({
          message: "delete successfully",
        });
      });
    } catch {}

    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
// export default app
module.exports = app;
