const express = require('express');
const cors = require('cors');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 5000;
const app = express();
const nodemailer = require("nodemailer");
const sgTransport = require('nodemailer-sendgrid-transport');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY); 

// Middleware
app.use(express.json());
app.use(cors());


//JSON WEB TOKEN
function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: "UnAuthorized access" })
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: "Forbidden access" })
        }
        req.decoded = decoded;
        next()
    });
}





const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ndvbmgv.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

// Send Nodemailer

const emailSenderOptions = {
    auth: {
        api_key: process.env.EMAIL_SENDER_KEY
    }
}

const emailClient = nodemailer.createTransport(sgTransport(emailSenderOptions));

function sendPurchaseEmail(purchase){
    const { productName,price,userEmail,userName}= purchase;
    const email ={
        from: process.env.EMAIL_SENDER,
        to: userEmail,
        subject: `You purchase at ${productName} is on ${price} is confirmed`,
        text:`You purchase at ${productName} is at ${price} is confirmed`,
        html:`
        <div>
        <h1 style="color:'green'"> Hello ${userName}, </h1>
        <h3>Your product purchase for ${productName} is confirmed</h3>
        <p>Please pay for ${price}</p>
        <h2>Our address</h2>
        <p>Mohammadpur,Dhaka,Bangladesh</p>
        </div>
        `
    };

    emailClient.sendMail(email,function(err,info) {
        if(err){
            console.log(err);
        }
        else{
            console.log('Message sent', info)
        }
    })
}


function sendPaymentConfirmationEmail(payment){
    const { transactionId,price,userEmail,userName}= payment;
    const email ={
        from: process.env.EMAIL_SENDER,
        to: userEmail,
        subject: `We have received your payment for ${transactionId} is on ${price} is confirmed`,
        text:`You are paying  at ${price} is confirmed`,
        html:`
        <div>
        <h1 style="color:'green'"> Hello ${userName} </h1>
        <h3>Your product purchase for transaction Id ${transactionId} is confirmed. Thank you for your payment</h3>
        <p>Thank you for your payment</p>
        <h2>Our address</h2>
        <p>Mohammadpur,Dhaka,Bangladesh</p>
        </div>
        `
    };

    emailClient.sendMail(email,function(err,info) {
        if(err){
            console.log(err);
        }
        else{
            console.log('Message sent', info)
        }
    })
}

async function run() {
    try {
        await client.connect();
        const productCollection = client.db('em-gimbal').collection('products');
        const purchaseCollection = client.db('em-gimbal').collection('purchase');
        const userCollection = client.db('em-gimbal').collection('users');
        const paymentsCollection = client.db('em-gimbal').collection('paymnets');


        const  verifyAdmin= async(req,res,next)=> {
            const requester = req.decoded.email;
            const requesterAccount = await userCollection.findOne({ email: requester });
            if (requesterAccount.role === 'admin'){
                next();
            }
            else{
                res.status(403).send({message:"Forbidden"})
            }
            
        }



        // Getting All product

        app.get('/products', async (req, res) => {
            const products = await productCollection.find().toArray();
            res.send(products)
        });

        // Single Product with details
        app.get('/products/:id', async (req, res) => {
            const productId = req.params.id;
           
            const query = { _id: ObjectId(productId) };
            const singleProducts = await productCollection.findOne(query);
            res.send(singleProducts)
        });
        // Post purchase
        app.post('/purchase', async (req, res) => {
            const purchase = req.body;
            const result = await purchaseCollection.insertOne(purchase);
            sendPurchaseEmail(purchase)
            res.send(result)
        });

        app.get('/purchase', verifyToken, async (req, res) => {
            const userEmail = req.query.user;
            const decodedEmail = req.decoded.email;
            if (userEmail === decodedEmail) {
                const query = { userEmail: userEmail }
                const result = await purchaseCollection.find(query).toArray();
                res.send(result)
            }
            else {
                return res.status(403).send({ message: "Forbidden Access" })
            }
        });

        app.get('/purchase/:id',async(req,res)=>{
            const id = req.params.id;
            const query ={_id: ObjectId(id)}
            const purchase= await purchaseCollection.findOne(query);
            res.send(purchase)
        });
        app.patch('/purchase/:id', async(req,res)=>{
            const id = req.params.id;
            const payment = req.body;
            const filter ={_id: ObjectId(id)}
            const updateDoc = {
                $set: {
                    paid:true,
                    transactionId:payment.transactionId
                }
            }
            const result= await paymentsCollection.insertOne(payment);
            const updatedPurchase = await purchaseCollection.updateOne(filter,updateDoc);
            sendPaymentConfirmationEmail(payment);
            
            res.send(updateDoc);

        })
        // Update or insert new user
        app.put('/users/:email', async (req, res) => {
            const email = req.params.email;
            const user = req.body;
            const filter = { email: email };
            const options = { upsert: true };
            const updateDoc = {
                $set: user
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ result, token })
        })

        //Set admin role

        app.put('/users/admin/:email', verifyToken,verifyAdmin, async (req, res) => {
            const email = req.params.email;           
                const filter = { email: email };
                const updateDoc = {
                    $set: { role: 'admin' },
                };
                const result = await userCollection.updateOne(filter, updateDoc);
                res.send(result)
        });

        // Check Admin
        app.get('/admin/:email',async(req,res)=>{
            const email=req.params.email;
            const user = await userCollection.findOne({email:email});
            const isAdmin = user.role === 'admin'
            res.send({admin: isAdmin})
        })

        app.get('/users', verifyToken, async (req, res) => {
            const users = await userCollection.find().toArray();
            res.send(users)
        });

        // Add a new product as admin
        app.post('/products',verifyToken,verifyAdmin, async (req, res) => {
            const product = req.body;
            const result = await productCollection.insertOne(product);
            res.send(result)
        });


        app.delete('/products/:id',verifyToken,verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter ={_id: ObjectId(id)}
            const result = await productCollection.deleteOne(filter);
            res.send(result)
        });

        app.post('/create-payment-intent',async(req,res)=>{
            const {price}=req.body;
            const amount = price*100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            });
            res.send({
                clientSecret: paymentIntent.client_secret})
        })
    }
    finally {

    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send("em-gimbal-server is running")
});

app.listen(port, (req, res) => {
    console.log("Port is running", port)
})
