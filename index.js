const express = require("express");
const app = express();
let cors = require("cors");
const port = process.env.PORT || 3000;
app.use(express.json());
app.use(cors());
require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@crud.p5kddzk.mongodb.net/?retryWrites=true&w=majority`;

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
        requestData.status  = "pending"
        const result = await requestsCollection.insertOne(requestData);
        res.send(result);
      });

      // user get
      app.get("/user/:email/role", async (req, res) => {
        let email = req.params.email;
        let query = { email };
        let user = await register.findOne(query);
        res.send(user?.role || "user");
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

      app.get("/employee-assets", async (req, res) => {
        const assets = await assetsCollection
          .find({ availableQuantity: { $gt: 0 } })
          .toArray();

        res.send(assets);
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
