const express = require("express");
const chalk = require("chalk");
const socketIO = require("socket.io");

// SET UP SERVER ======================================================================
// get all the tools we need
var app      = express();
var port     = process.env.PORT || 3700;
var mongoose = require('mongoose');
var passport = require('passport');
var flash    = require('connect-flash');

var morgan       = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser   = require('body-parser');
var expressSession      = require('express-session');

var configDB = require('./config/database.js');

// configuration ===============================================================
mongoose.connect(configDB.url); // connect to our database
require('./config/passport')(passport); // pass passport for configuration


const {
    AttributeIds,
    OPCUAClient,
    TimestampsToReturn,
} = require("node-opcua");

const endpointUrl = "opc.tcp://DN-ThanhVT.orientsoftware.net:4840";
const nodeIdToMonitor = "ns=1;s=\"Device_1\".\"Variable_1\"";

(async () => {
    try {
        /////////////////////////////////
        const client = OPCUAClient.create({
            endpoint_must_exist: false
        });
        client.on("backoff", (retry, delay) => {
            console.log("Retrying to connect to ", endpointUrl, " attempt ", retry);
        });
        console.log(" connecting to ", chalk.cyan(endpointUrl));
        await client.connect(endpointUrl);
        console.log(" connected to ", chalk.cyan(endpointUrl));
        //////////////////////////////////

        const session = await client.createSession();
        console.log(" session created".yellow);

        const subscription = await session.createSubscription2({
            requestedPublishingInterval: 2000,
            requestedMaxKeepAliveCount: 20,
            requestedLifetimeCount: 6000,
            maxNotificationsPerPublish: 1000,
            publishingEnabled: true,
            priority: 10
        });

        subscription.on("keepalive", function () {
            console.log("keepalive");
        }).on("terminated", function () {
            console.log(" TERMINATED ------------------------------>")
        });

        // set up our express application
        app.use(morgan('dev')); // log every request to the console
        app.use(cookieParser()); // read cookies (needed for auth)
        app.use(bodyParser.json()); // get information from html forms
        app.use(bodyParser.urlencoded({ extended: true }));
        app.set('view engine', 'ejs'); // set up ejs for templating

        // required for passport
        app.use(expressSession({
            secret: 'ilovescotchscotchyscotchscotch', // session secret
            resave: true,
            saveUninitialized: true
        }));
        app.use(passport.initialize());
        app.use(passport.session()); // persistent login sessions
        app.use(flash()); // use connect-flash for flash messages stored in session

        // routes ======================================================================
        require('./app/routes.js')(app, passport); // load our routes and pass in our app and fully configured passport

        const io = socketIO.listen(app.listen(port));

        io.sockets.on('connection', function (socket) {
        });

        // --------------------------------------------------------

        const itemToMonitor = {
            nodeId: nodeIdToMonitor,
            attributeId: AttributeIds.Value
        };
        const parameters = {
            samplingInterval: 100,
            discardOldest: true,
            queueSize: 100
        };
        const monitoredItem = await subscription.monitor(itemToMonitor, parameters, TimestampsToReturn.Both);

        monitoredItem.on("changed", (dataValue) => {
            console.log(dataValue.value.toString());
            io.sockets.emit('message', {
                value: dataValue.value.value,
                timestamp: dataValue.serverTimestamp,
                nodeId: nodeIdToMonitor,
                browseName: "Temperature"
            });
        });

        // detect CTRL+C and close
        let running = true;
        process.on("SIGINT", async () => {
            if (!running) {
                return; // avoid calling shutdown twice
            }
            console.log("shutting down client");
            running = false;

            await subscription.terminate();

            await session.close();
            await client.disconnect();
            console.log("Done");
            process.exit(0);

        });

    }
    catch (err) {
        console.log(chalk.bgRed.white("Error" + err.message));
        console.log(err);
        process.exit(-1);
    }
})();

