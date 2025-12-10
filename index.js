const express = require("express");
require("dotenv").config();
const cors = require("cors");

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

// Firebase Admin
const admin = require("firebase-admin");
const serviceAccount = require("./firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ---------------------------
// MIDDLEWARE: VERIFY TOKEN
// ---------------------------
const verifyFBtoken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decode = await admin.auth().verifyIdToken(idToken);

    req.decode_email = decode.email; //
    next();
  } catch (err) {
    return res.status(403).send({ message: "invalid or expired token" });
  }
};

app.use(express.json());
app.use(cors());

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_NAME}:${process.env.DB_PASS}@cluster0.4xbagdk.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    console.log("Connected to MongoDB successfully!");
    // ==================================
    const db = client.db("Chellange_Hive");

    const usersCollection = db.collection("users");
    const creatorsCollection = db.collection("creators");
    const contestCollection = db.collection("contest");

    // ===========
    // Admin verify token
    const verifyAdmin = async (req, res, next) => {
      const email = req.decode_email;
      const filter = { email };
      const user = await usersCollection.findOne(filter);
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Forbidden access" });
      }
      next();
    };
    // Admin verify token
    const verifyCreator = async (req, res, next) => {
      const email = req.decode_email;
      const filter = { email };
      const user = await usersCollection.findOne(filter);
      if (!user || user.role !== "creator") {
        return res.status(403).send({ message: "Forbidden access" });
      }
      next();
    };
    // ==========Contest related api=====
    // 1.এটা Create Contest form থেকে data পাঠানো হচ্ছে database এ add করার জন্য

    app.post("/contest", verifyFBtoken, verifyCreator, async (req, res) => {
      const data = req.body;
      const result = await contestCollection.insertOne(data);
      res.send(result);
      // console.log(data);
    });
    // 2 This api for show contest of the indivisual user
    app.get("/myContest", async (req, res) => {
      const email = req.query.email;
      const filter = { email };
      const result = await contestCollection.find(filter).toArray();
      res.send(result);
    });
    // 3 Api for getting the prefield form
    app.get("/contestForEdit/:id", async (req, res) => {
      const id = req.params.id;

      const filterId = { _id: new ObjectId(id) };
      const result = await contestCollection.findOne(filterId);
      res.send(result);
    });
    // 4 api for edit contest
    app.patch("/updateContest/:id", async (req, res) => {
      const id = req.params.id;
      const data = req.body;
      const filter = { _id: new ObjectId(id) };
      // console.log(data);
      const updateData = {
        $set: data
      };

      const result = await contestCollection.updateOne(filter, updateData);
      res.send(result);
    });
// Api for manage contest from admin reject apporve
app.get('/manageContest',async(req,res)=>{
  const result=await contestCollection.find().toArray()
  res.send(result)
})
// 5 update status of contest
app.patch('/updateContestStatus',async(req,res)=>{
  const id=req.body.id
  const status=req.body.status
  const filter={_id: new ObjectId(id)}
  const updateData={
    $set:{
      status:status
    }
  }
  const result=await contestCollection.updateOne(filter,updateData)
  res.send(result)
  // console.log(status);
  
})
// COntest delete by admin when he is approving in manage contest page
app.delete('/deleteContestByAdmin/:id',async(req,res)=>{
  const id=req.params.id
  console.log(id);
  
  const filter={_id: new ObjectId(id)}
  const result=await contestCollection.deleteOne(filter)
  res.send(result)
})
    // Contest delete api
    app.delete('/contestDelete/:id',async(req,res)=>{
      const id=req.params.id;
      const filter={_id: new ObjectId(id)}
      const result=await contestCollection.deleteOne(filter)
      res.send(result)
    })
    // Creators related APIs -===*******=========
    // -user request দিচ্ছে যে সে contest creator হবে
    app.post("/creators", async (req, res) => {
      const creatorsData = req.body;
      creatorsData.status = "pending";
      const result = await creatorsCollection.insertOne(creatorsData);

      res.send(result);
    });
    // user এর request গুলা নেওয়া হচ্ছে যেটা admin দেখবে এবং creator হিসেবে accept ,reject করবে
    app.get("/creators", verifyFBtoken, async (req, res) => {
      const result = await creatorsCollection.find().toArray();
      res.send(result);
    });
    // এটা creator এর status update করার জন্য,যেমন approve reject
    app.patch("/updateCreators", async (req, res) => {
      const info = req.body;
      const email = req.body.email;
      const filterOnUser = { email };
      const filter = { _id: new ObjectId(req.body.id) };
      const updateStatus = {
        $set: {
          status: req.body.status,
        },
      };
      if (req.body.status === "Approved") {
        const updateUserRole = {
          $set: {
            role: "creator",
          },
        };
        const resultUser = await usersCollection.updateOne(
          filterOnUser,
          updateUserRole
        );
        // res.send(resultUser)
      }
      // console.log(info);
      const result = await creatorsCollection.updateOne(filter, updateStatus);

      res.send(result);
    });
    //

    // User related APIs -===*******=========

    // Api for get all the data of api
    // এই api manageUsers page এ role Toggle করার জন্য use হবে
    app.patch("/userRoleUpdate", async (req, res) => {
      const email = req.query.email;
      const status = req.body;
      console.log(email, status);
      const filter = { email };
      const updateRole = {
        $set: {
          role: status.role,
        },
      };
      const result = await usersCollection.updateOne(filter, updateRole);

      res.send(result);
    });

    // এটা নেওয়া হচ্ছে Role Toogle করার জন্য manageUsers reute er জন্য
    app.get("/manageUsers", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });
    app.post("/users", async (req, res) => {
      const usersData = req.body;
      usersData.role = "user";
      const userEmail = req.body.email;
      const filter = { email: userEmail };
      const exits = await usersCollection.findOne(filter);
      if (exits) {
        return res.send({ message: "Already exits this user" });
      }

      const result = await usersCollection.insertOne(usersData);
      res.send(result);
    });
    // Api for useRole custom hook create
    app.get("/users/:email/role", verifyFBtoken, async (req, res) => {
      const email = req.params.email;
      const filter = { email };
      const result = await usersCollection.findOne(filter);

      res.send({ role: result?.role || "user" });
    });
  } finally {
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
