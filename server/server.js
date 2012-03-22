#!/usr/bin/env node

var tls = require('tls');
var WebSocketServer = require('websocket').server;
var http = require('http');
var https = require('https');
var argv = process.argv;
var express = require('express')
var server = express.createServer();
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


gSessionTable = {};
gTopicTable = {};

// NOTE This implementation assumes only one socket per user!
// Fixing that will require some more sophisticated indexing.
function addSession(id, expires, socket) {
	var obj = gSessionTable[id];
	if (!obj) {
		obj = gSessionTable[id] = {};
	}
	obj.expires = expires;
	obj.socket = socket;
	socket.userid = id;
	log("Update session table: " + id + " at " + socket.remoteAddress);
}

function clearSession(socket) {
	if (socket.id && gSessionTable[socket.userid]) {
		log("Update session table: remove " + socket.userid + " at " + socket.remoteAddress);
		delete gSessionTable[socket.userid];
	}
}

function broadcastToAllConnections(msg)
{
	for (var s in gSessionTable) {
		try {
			gSessionTable[s].socket.send(msg);
		} catch (e) {
			log("Error while broadcasting to " + s.socket.userid);
		}
	}
}

function getSession(id) {
	return gSessionTable[id];
}

function getOnlineFriends(id) {
	var ret = [];
	for (k in gSessionTable) {
		ret.push( { id: k, icon: makeIcon(k), presence: "on"} )
	}
	return ret;
}

function makeIcon(id) {
	if (!id) {
		return SERVER_DOMAIN + "/generic_person.png";
	}
	var icon = 'http://www.gravatar.com/avatar/' + 
			crypto.createHash('md5').update(id.toLowerCase().trim()).digest('hex') +
			"?s=32";
	return icon;
}


function createSessionAgent(clientConnection)
{
	var session = {};
	clientConnection.on('message', function(message) {
		log("Got message");
		try {

			if (message.type === 'utf8') {
				log("Got request: " + message.utf8Data);
				var cmd = JSON.parse(message.utf8Data);
				if (cmd.cmd == "connect") {
					var body = "assertion=" + cmd.assertion + "&audience=" + SERVER_DOMAIN;
					var options = {
						host: 'browserid.org', port: 443,
						method: 'POST', path: '/verify',					
						headers: { "Content-Length" : body.length, "Content-Type": "application/x-www-form-urlencoded"}
					};

					var req = https.request(options, function(res) {
						//log("statusCode: " + res.statusCode);
						//log("headers: " + res.headers);

						res.on('data', function(d) {
							// process.stdout.write(d);
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
								// and tell everybody that you just came on
								broadcastToAllConnections(JSON.stringify(
										{cmd:"presenceupdate",
										id:result.email,
										icon:icon,
										presence:"on"
										}
								));
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

				} else if (cmd.cmd == "getfriends") {
					var friends = getOnlineFriends(session.id);
					var cmd = {
							cmd: "getfriendsresp",
							friends: friends
					};
					var cmdStr = JSON.stringify(cmd);
					log("sending friend list: " + cmdStr);
					clientConnection.sendUTF(cmdStr);
				} else if (cmd.cmd == "sendmessage") {

					log("Got sendMessage; sessionID is " + session.id);

					var toSession = getSession(cmd.to);
					if (toSession) {
						toSession.socket.sendUTF(JSON.stringify( {
							cmd: "newmessage",
							from: session.id,
							fromIcon: makeIcon(session.id),
							to: cmd.to,
							msg: cmd.msg,
							time: new Date().getTime()
						}))
					} // else queue it up
					else {
						log("Message received for " + cmd.to + "; not online, should queue it");
					}
				} else if (cmd.cmd == "subscribe") {

				} else if (cmd.cmd == "publish") {

				} else if (cmd.cmd == "video") {
					var toSession = getSession(cmd.to);
					if (toSession) {
						toSession.socket.sendUTF(JSON.stringify({
							cmd: "video",
							from: session.id,
							to: cmd.to,
							msg: cmd.msg
						}));
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
			clearSession(clientConnection);

			// and tell everybody that you just left
			broadcastToAllConnections(JSON.stringify(
				{
					cmd:"presenceupdate",
					id:session.id,
					presence:"off"
				}
			));

		} catch (e) {
			log("Error in clientConnection.close: " + e);
		}
	});
}

