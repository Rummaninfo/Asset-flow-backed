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

  try{
    let db = client.db("asset-flow")
    let register = db.collection("register")


    app.post("/register", async (req, res)=>{
        let data = req.body 
        let result = await register.insertOne(data)
        res.send({message:true, result})
    })

  }
  catch{

  }

    
  
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    
  }
}
run().catch(console.dir);
