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
const SERVER_DOMAIN = "http://browsewithme.org:" + port;

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
function addSession(email, expires, socket) {
	var obj = gSessionTable[email];
	if (!obj) {
		obj = gSessionTable[email] = {};
	}
	obj = expires;
	obj = socket;
	socket.email = email;
	log("Update session table: " + email + " at " + socket.remoteAddress);
}

function clearSession(socket) {
	if (socket.email && gSessionTable[socket.email]) {
		log("Update session table: remove " + socket.email + " at " + socket.remoteAddress);
		delete gSessionTable[socket.email];
	}
}

function getOnlineFriends(id) {
	var ret = [];
	for (k in gSessionTable) {
		ret.push( { id: k, icon: makeIcon(k)} )
	}
	return ret;
}

function makeIcon(id) {
	var icon = 'http://www.gravatar.com/avatar/' + 
			crypto.createHash('md5').update(id.toLowerCase().trim()).digest('hex') +
			"?s=32";
	return icon;
}
function createSessionAgent(clientConnection)
{
	clientConnection.on('message', function(message) {
		try {
			if (message.type === 'utf8') {
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

								var icon = makeIcon(result.email);
								clientConnection.sendUTF(JSON.stringify(
									{
										cmd:"connack",
										status:"ok",
										id:result.email,
										icon:icon
									}
								));

								clientConnection.sendUTF(JSON.stringify(
									getOnlineFriends(result.email)
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

				} else if (cmd.cmd == "subscribe") {

				} else if (cmd.cmd == "publish") {

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
		} catch (e) {
			log("Error in clientConnection.close: " + e);
		}
	});
}

