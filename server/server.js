#!/usr/bin/env node

var tls = require('tls');
var WebSocketServer = require('websocket').server;
var http = require('http');
var https = require('https');
var argv = process.argv;
var express = require('express')
var server = express();
var crypto = require('crypto');
var querystring = require('querystring');

// Process arguments and configure server:
for (var i = 2; i <= 2; i++) {
	if(!argv[i]) {
		console.log("Usage: server <port>");
		process.exit(-1);
	}
}
var port = Number(argv[2]);
const SERVER_DOMAIN = "http://demosocialservice.org:" + port;

const BROWSERID_VERIFIER = "browserid.org";
const BROWSERID_VERIFIER_PORT = 443;
const BROWSERID_VERIFIER_PATH = "/verify";

server.configure('development', function(){
	server.use(express.static(__dirname + '/content'));
	server.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

wsServer = new WebSocketServer({
		httpServer: server,
		// You should not use autoAcceptConnections for production
		// applications, as it defeats all standard cross-origin protection
		// facilities built into the protocol and the browser.  You should
		// *always* verify the connection's origin and decide whether or not
		// to accept it.
		autoAcceptConnections: false
});

function log(msg) {
	console.log(new Date().toISOString() + " " + msg);
}

// Start it up:
server.listen(port);

// Server logic follows:
function originIsAllowed(origin) {
	// put logic here to detect whether the specified origin is allowed.
	log("Do we allow origin " + origin +"? Yes.");
	return true;
}

wsServer.on('request', function(request) {
	if (!originIsAllowed(request.origin)) {
		// Make sure we only accept requests from an allowed origin
		request.reject();
		log('Connection from origin ' + request.origin + ' rejected.');
		return;
	}

	try {
		var connection = request.accept(null, request.origin);
		log('Connection accepted.');

		createSessionAgent(connection);
	} catch (e) {
		log('Error while setting up connection: ' + e);
	}
});

/**************************************
 * User session tracking
 *
 * The gSessionTable contains an entry for each of the active
 * users, keyed on their ID.  The session entry contains a list
 * of all the connections for this user.  Each connection record
 * contains the socket, a device descriptor, and an activity
 * timestamp.
 *
 * The socket is annotated with the user's identifer, to allow
 * network I/O events to be correlated back to user identities.
 *
 * A "device descriptor" is an opaque string that helps the
 * user name their devices; it is chosen by the client and is
 * not intended to automatically be unique or stable.
 *
 * It is the responsibility of the reapIdleConnections method
 * to detect which user sessions have become inactive and to
 * close them out of the table.
 */

gSessionTable = {};

/** Add a user session, given a userID, device descriptor, and socket. */
function addSession(userID, deviceDesc, socket) {

	var obj = gSessionTable[userID];
	if (!obj) {
		obj = gSessionTable[userID] = {};
	}

	var conn = {};

	conn.activity = new Date().getTime();
	conn.device = deviceDesc;
	conn.socket = socket;
	socket.userid = userID;
	if (!obj.connections) obj.connections = [];
	obj.connections.push(conn);

	log("Update session table: " + userID + " at " + socket.remoteAddress);
}

/** Given a socket, clear out the session for the socket.  Typically
 * called in response to a network close or reset. */
function clearSessionForSocket(socket) {

	var userid = socket.userid;
	if (userid && gSessionTable[userid]) 
	{
		log("Update session table: remove " + userid + " at " + socket.remoteAddress);
		var session = gSessionTable[userid];
		if (!session.connections) {
			log("Error: clearSessionForSocket called on a session that had no connections.  User session tracking error?");
			return;
		}
		for (var i in session.connections) {
			if (session.connections[i].socket == socket) {
			    session.connections.splice(i, 1);
			}
		}
		if (session.connections.length == 0) {
			// no more sessions for this user: take them out of the table
			delete gSessionTable[userid];

			// and tell the world they have gone offline
			broadcastPresence(userid, "off");
		}
	}
	else
	{
		log("socket closed without a userid: failure during login?");
	}
}

/** Sends the given message to all the connections for this session */
function sendToAllConnections(aSession, msg) 
{
	if (typeof msg == "object") msg = JSON.stringify(msg);

	for (var c in aSession.connections)
	{
		try {	
			aSession.connections[c].socket.sendUTF(msg);
		} catch (e) {
			log("Error while sending to connection " + c + " of " + aSession.connections[c].userid + ": " + e);
		}
	}
}

/** Tell all connections that this user has gone offline */
function broadcastPresence(userid, status)
{
	broadcastToAllConnections({
			cmd:"presenceupdate",
			id:userid,
			icon:makeIcon(userid),
			presence:status
	}, 
	{
		except: userid
	});
}

/** Send a message to all active connections */
function broadcastToAllConnections(msg, options)
{
	if (typeof msg == "object") msg = JSON.stringify(msg);

	for (var s in gSessionTable) {
		if (options && options.except == s) continue;
		var session = gSessionTable[s];
		for (var i in session.connections) {
			try {
				session.connections[i].socket.send(msg);
			} catch (e) {
				log("Error while broadcasting to connection " + i + " of " + s + ": " + e);
			}
		}
	}
}

/** Given a userID, get the session for it */
function getSession(id) {
	return gSessionTable[id];
}

/** Return an array of records containing all active users */
function getOnlineUsers() {
	var ret = [];
	for (var k in gSessionTable) {
		ret.push( { id: k, icon: makeIcon(k), presence: "on"} )
	}
	return ret;
}

/** Make an icon for the given userID */
function makeIcon(id) {
	if (!id) {
		return SERVER_DOMAIN + "/generic_person.png";
	}
	var icon = 'http://www.gravatar.com/avatar/' + 
			crypto.createHash('md5').update(id.toLowerCase().trim()).digest('hex') +
			"?s=32";
	return icon;
}

function reapIdleConnections()
{
	var now = new Date().getTime();// assuming runtime of this is fast enough for just one "now"

	// Two passes - get the idles and then close them
	var idles = [];
	for (var u in gSessionTable)
	{
		for (var i in u.connections) {
			if (u.connections[i].activity - now > SESSION_IDLE_EXPIRY_TIME_SEC * 1000) {
				idles.push([u,i]);
			}
		}
	}

	for (var i in idles) {
		try {
			var user = i[0];
			var conn = i[1];

			clearSessionForSocket(gSessionTable[i].connections[conn]);

		} catch (e) {
			log("Error while closing idle socket: " + e);
		}
	}
}
setTimeout(reapIdleConnections, 5000);

/** The core user session handler */
function createSessionAgent(clientConnection)
{
	var session = {};
	clientConnection.on('message', function(message) {
		log("Got message");
		try {

			if (message.type === 'utf8') {
				log("Got request: " + message.utf8Data);
				var cmd = JSON.parse(message.utf8Data);
				
				// connect is used to authenticate a user 
				if (cmd.cmd == "connect") {

					var body = "assertion=" + cmd.assertion + "&audience=" + SERVER_DOMAIN;
					var options = {
						host: BROWSERID_VERIFIER, 
						port: BROWSERID_VERIFIER_PORT,
						path: BROWSERID_VERIFIER_PATH,					
						method: 'POST', 
						headers: { "Content-Length" : body.length, "Content-Type": "application/x-www-form-urlencoded"}
					};

					var req = https.request(options, function(res) {
						res.on('data', function(d) {
							var result = JSON.parse(d);
							if (result.status == "okay") {
								addSession(result.email, result.expires, clientConnection);
								session.id = result.email;
								session.idExpires = result.expires;

								var icon = makeIcon(result.email);
								clientConnection.sendUTF(JSON.stringify(
									{
										cmd:"connack",
										status:"ok",
										id:result.email,
										icon:icon
									}
								));

								try {
									// and tell everybody that you just came on
									broadcastPresence(session.id, "on");
								} catch (e) {
									log("Unable to notify presence of " +session.id);
								}
							} else {
								log("login failure: " + d);
								clientConnection.sendUTF(JSON.stringify(
									{
										cmd:"connack",
										status:"fail"
									}
								));
							}
						});
					});
					req.write(body);
					req.end();

					req.on('error', function(e) {
						console.error(e);
					});                

				} else if (cmd.cmd == "getusers") {

					var users = getOnlineUsers();
					var cmd = {
						cmd: "getusersresp",
						users: users
					};
					var cmdStr = JSON.stringify(cmd);
					log("sending user list: " + cmdStr);
					clientConnection.sendUTF(cmdStr);

				} else if (cmd.cmd == "sendmessage") {

					var toSession = getSession(cmd.to);
					if (toSession) {
						sendToAllConnections(toSession, {
							cmd: "newmessage",
							from: session.id,
							fromIcon: makeIcon(session.id),
							to: cmd.to,
							msg: cmd.msg,
							time: new Date().getTime()
						});
					} // else queue it up
					else {
						log("Message received for " + cmd.to + "; not online, should queue it");
					}
				} else if (cmd.cmd == "video") {
					var toSession = getSession(cmd.to);
					log("Request for video received from " + session.id + " to " + cmd.to + "; sending request to connections.");
					if (toSession) {
						sendToAllConnections(toSession, {
							cmd: "video",
							from: session.id,
							to: cmd.to,
							msg: cmd.msg
						});
					}
				} else if (cmd.cmd == "useractivity") {
					var toSession = getSession(cmd.to);
					log("user activity from " + session.id + " to " + cmd.to);
					if (toSession) {
						sendToAllConnections(toSession, {
							cmd:"useractivity",
							from: session.id,
							to: cmd.to,
							msg: cmd.msg
						})
					}

				} else {
					log("Unknown command: " + message.utf8Data);
				}
			}
		} catch (e) {
			log("Error in clientConnection.message: " + e);
		}
	});

	clientConnection.on('close', function(reasonCode, description) {
		try {
			log('Peer ' + clientConnection.remoteAddress + ' disconnected');
			clearSessionForSocket(clientConnection);
			broadcastPresence(session.id, "off");

		} catch (e) {
			log("Error in clientConnection.close: " + e);
		}
	});
}

