const express = require("express");
require("dotenv").config();
const cors = require("cors");
const stripe = require("stripe")(process.env.VITE_STRIPE_KEY);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

// Firebase Admin
const admin = require("firebase-admin");
const serviceAccount = require("./firebase-adminsdk.json");
const e = require("express");

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

    // +++============Payment Related apis
    // 1 Payment checkout
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: "usd",
              product_data: {
                name: paymentInfo?.contestName,
                description: paymentInfo?.description,
                images: [paymentInfo?.contestPhoto],
              },
              unit_amount: paymentInfo?.price * 100,
            },
            quantity: paymentInfo?.quantity,
          },
        ],
        customer_email: paymentInfo?.participant?.participantEmail,
        mode: "payment",
        metadata: {
          contestId: paymentInfo.contestId,
          participantEmail: paymentInfo?.participant?.participantEmail,
          participantName: paymentInfo?.participant?.participantName,
          participantPhoto: paymentInfo?.participant?.participatePhoto,
        },
        success_url: `${process.env.SITE_DOMAIN}paymentSuccess?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}paymentFailed`,
      });
      res.send({ url: session.url });
    });
    // 2 payment success api
    app.post("/paymentSuccess", async (req, res) => {
      const sessionId = req.body.sessionId;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const participantInfo = {
        transactionId: session.payment_intent,
        participantName: session.metadata.participantName,
        participantEmail: session.metadata.participantEmail,
        participantPhoto: session.metadata.participantPhoto,
        paymentStatus: "paid",
      };
      // console.log(session);
      // from here the work is started for taking the participant in the array who have paid
      if (session.status === "complete") {
        // const
        const filter = { _id: new ObjectId(session.metadata.contestId) };
        // Check existance of the user
        const alreadyExists = await contestCollection.findOne({
          _id: new ObjectId(session.metadata.contestId),
          "participants.participantEmail": participantInfo.participantEmail,
        });

        if (alreadyExists) {
          return res.send({ message: "Already Available" });
        }
        const update = {
          $push: { participants: participantInfo },
        };
        const result = await contestCollection.updateOne(filter, update);
        return res.send(result);
      }
    });
    // 3 after making payment post the link or info to the server
    app.patch("/taskInfo/:id", verifyFBtoken, async (req, res) => {
      const id = req.params.id;
      const info = req.body;
      const email = req.body.email;
      const filter = {
        _id: new ObjectId(id),
        "participants.participantEmail": email,
      };
      const updateData = {
        $push: {
          "participants.$.taskInfo": info,
        },
      };
      const result = await contestCollection.updateOne(filter, updateData);
      res.send(result);
    });
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
        $set: data,
      };

      const result = await contestCollection.updateOne(filter, updateData);
      res.send(result);
    });
    // 5 api for getting info for active btn
    app.get("/contest/participant", async (req, res) => {
      const { contestId, email } = req.query;
      if (!contestId || !email) {
        res.send("Data mission");
      }
      console.log(contestId, email);
      const contest = await contestCollection.findOne({
        _id: new ObjectId(contestId),
      });
      const participant = contest.participants.find(
        (p) => p.participantEmail === email
      );

      res.send(participant);
      // console.log(participant);
    });
    // 6 api for showing contest participants in submission
    app.get("/submission/:id", async (req, res) => {
      const id = req.params.id;

      const filter = await contestCollection.findOne({ _id: new ObjectId(id) });

      res.send(filter);
    });
    // 7 api for define the winner
    app.patch(`/declareWinner/:id`, async (req, res) => {
      const id = req.params.id;
      const { email } = req.query;
      console.log(email);

      const filter = { _id: new ObjectId(id) };
      const result = await contestCollection.findOne(filter);
      const update = {
        $set: { winner: email },
      };
      const updatedResult = await contestCollection.updateOne(filter, update);
      res.send(updatedResult);
    });
    // 8 api for show winner in details page with picture
    app.get("/winnerForDetails", async (req, res) => {
      const { email } = req.query;
      const filter = await usersCollection.findOne({ email });
      console.log(filter);
      res.send(filter);
    });
    // 9 Api for My participated contest by user
    app.get("/myParticipatedContests", async (req, res) => {
      const { email } = req.query;

      const result = await contestCollection
        .find({
          "participants.participantEmail": email,
          winner: { $exists: false },
        })
        .sort({ deadline: 1 })
        .toArray();

      res.send(result);
    });
    // 10. APi for myWinningContests by user
    app.get("/myWinningContests", async (req, res) => {
      try {
        const { email } = req.query;

        const result = await contestCollection
          .find({ winner: email })
          .toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
      }
    });
    // Api for manage contest from admin reject apporve
    app.get("/manageContest", async (req, res) => {
      const result = await contestCollection.find().toArray();
      res.send(result);
    });
    // 5 update status of contest
    app.patch("/updateContestStatus", async (req, res) => {
      const id = req.body.id;
      const status = req.body.status;
      const filter = { _id: new ObjectId(id) };
      const updateData = {
        $set: {
          status: status,
        },
      };
      const result = await contestCollection.updateOne(filter, updateData);
      res.send(result);
      // console.log(status);
    });
    // COntest delete by admin when he is approving in manage contest page
    app.delete(
      "/deleteContestByAdmin/:id",
      verifyFBtoken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        console.log(id);

        const filter = { _id: new ObjectId(id) };
        const result = await contestCollection.deleteOne(filter);
        res.send(result);
      }
    );
    // Contest delete api==============================************+======================
    // 1 This api for delete contest by creator
    app.delete(
      "/contestDelete/:id",
      verifyFBtoken,
      verifyCreator,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const result = await contestCollection.deleteOne(filter);
        res.send(result);
      }
    );
    // 2. This api for getting all contest for in the AllContests Navbar
    app.get("/allContests", verifyFBtoken, async (req, res) => {
      const result = await contestCollection
        .find({ status: "Approved" })
        .toArray();
      res.send(result);
    });
    // 3 getting data for show details of a contest
    app.get("/contestDetails/:id", verifyFBtoken, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await contestCollection.findOne(filter);
      res.send(result);
    });
    // Creators related APIs -===*******=========
    // -user request দিচ্ছে যে সে contest creator হবে
    app.post("/creators", verifyFBtoken, verifyCreator, async (req, res) => {
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
    app.patch(
      "/updateCreators",
      verifyFBtoken,
      verifyAdmin,
      async (req, res) => {
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
      }
    );
    //

    // User related APIs -===*******=========

    // Api for get all the data of api
    // এই api manageUsers page এ role Toggle করার জন্য use হবে
    app.patch(
      "/userRoleUpdate",
      verifyFBtoken,
      verifyAdmin,
      async (req, res) => {
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
      }
    );

    // এটা নেওয়া হচ্ছে Role Toogle করার জন্য manageUsers route er জন্য by admin
    app.get("/manageUsers", verifyFBtoken, verifyAdmin, async (req, res) => {
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
    // 1. api for profile
    app.get('/users/profile',async(req,res)=>{
      const {email}=req.query;
      const result=await usersCollection.findOne({email})
      res.send(result)
    })
    // 2 update profile
    app.patch('/updateProfile',async(req,res)=>{
      try {
        const {email}=req.query;
        const {displayName,photoURL}=req.body;
      console.log(typeof(photoURL));
      const filter={email}
      const updateDoc={
        $set:{
          displayName:displayName,
          photoURL:photoURL

        }
      }
      const result=await usersCollection.updateOne(filter,updateDoc)
      res.send(result)
        
      } catch (error) {
        console.log(error)
      }
    })
  } finally {
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
