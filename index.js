const express = require("express");
const app = express();
let cors = require("cors");
const port = process.env.PORT || 3000;
app.use(express.json());
app.use(cors());
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@crud.p5kddzk.mongodb.net/?retryWrites=true&w=majority`;
// stripe

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

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    try {
      let db = client.db("asset-flow");
      let register = db.collection("register");
      let assetsCollection = db.collection("assets");
      let requestsCollection = db.collection("requestCollection");
      let assignedAssetsCollection = db.collection("assignedAssets");
      let employeeAffiliationsCollection = db.collection("employeeAffiliation");
      let Packages = db.collection("Packages");

      //

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

            if (!existingAffiliation) {
              await employeeAffiliationsCollection.insertOne({
                employeeEmail: request.requesterEmail,
                employeeName: request.requesterName,
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
                requestStatus: status,
                approvalDate: status === "approved" ? new Date() : null, // ✅ যোগ করুন
                processedBy: processedBy || request.hrEmail, // ✅ কে করলো
                decisionDate: new Date(),
              },
            }
          );

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

      // register post
      app.post("/register", async (req, res) => {
        let data = req.body;
        let result = await register.insertOne(data);
        res.send({ message: true, result });
      });

      app.post("/add-asset", async (req, res) => {
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

      console.log(req.body)
  try {
    const paymentinfo = req.body;

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
      },

      success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
      cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancel`,
    });

    res.send({ url: session.url });
  } catch (error) {
    console.error("Stripe Checkout Error:", error);
    res.status(500).send({ error: "Checkout session তৈরি করা যায়নি" });
  }
});

      //  confused**
      // app.get("/user/:email", async (req, res) => {
      //   const email = req.params.email;
      //   const user = await register.findOne({ email });
      //   res.send(user);
      // });

      // user get
      app.get("/user/:email/role", async (req, res) => {
        let email = req.params.email;
        let query = { email };
        let user = await register.findOne(query);
        res.send(user?.role || "user");
      });
      app.get("/user/:email", async (req, res) => {
        let email = req.params.email;
        let query = { email };
        let result = await register.findOne(query);
        res.send(result);
      });

      // assets get
      app.get("/assets-list", async (req, res) => {
        let result = await assetsCollection.find().toArray();
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

      app.get("/hr-requests/:hrEmail", async (req, res) => {
        const hrEmail = req.params.hrEmail;
        const result = await requestsCollection.find({ hrEmail }).toArray();
        res.send(result);
      });

      // my team
      app.get("/my-team/:companyName", async (req, res) => {
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

      // employee list

      app.get("/hr/employees/:hrEmail", async (req, res) => {
        try {
          const hrEmail = req.params.hrEmail;

          const employees = await employeeAffiliationsCollection
            .find({ hrEmail })
            .toArray();

          res.send({
            success: true,
            employees,
          });
        } catch (error) {
          res.status(500).send({
            success: false,
            employees: [],
          });
        }
      });

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
      app.get("/employee-assets", async (req, res) => {
        const assets = await assetsCollection
          .find({ availableQuantity: { $gt: 0 } })
          .toArray();

        res.send(assets);
      });

      app.get("/packages", async (req, res) => {
        let result = await Packages.find().toArray();
        res.send(result);
      });

      app.delete("/employee/:id", async (req, res) => {
        let id = req.params.id;
        let filter = { _id: new ObjectId(id) };
        let result = await employeeAffiliationsCollection.deleteOne(filter);
        res.send(result);
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
