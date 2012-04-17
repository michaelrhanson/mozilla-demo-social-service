/* this is the worker */

dump("\n\n\nHELLO WORKER WORLD\n\n\n");

// This keeps a list of all the ports that have connected to us
_broadcastReceivers = [];

function log(msg) {
	dump(new Date().toISOString() + ": [dssworker] " + msg + "\n");
	try {
		console.log(new Date().toISOString() + ": [dssworker] " + msg);
	} catch (e) {}
}

// Called when the worker connects a message port
onconnect = function(e) {
	try {
		var port = e.ports[0];
		_broadcastReceivers.push(port);
		log("worker onconnect - now " + _broadcastReceivers.length + " connections.");

		port.onmessage = function(e) {
			log("worker onmessage: " + JSON.stringify(e.data));
			
			var msg = e.data;
			if (!msg) {
				log("onmessage called with no data")
				return;
			}
            // handle the special message that tells us a port is closing.
            if (msg.topic && msg.topic == "social.port-closing") {
                var index = _broadcastReceivers.indexOf(port);
                if (index != -1) {
                    log("removed receiver " + index);
                    _broadcastReceivers.splice(index, 1);
                }
                log("bwmworker port closed - now " + _broadcastReceivers.length + " connections.");
                return;
            }

			if (msg.topic && handlers[msg.topic])
				handlers[msg.topic](port, msg.data);
			else
				log("message topic not handled: "+msg.topic)
		}
	} catch (e) {
		log(e);
	}
}


var RECOMMEND_ICON="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAC7ElEQVQ4jW2TS28bZRSGn7l4xnfHTopNLlYToC1JqMQlIHFRRDdISKWLClFVbIBFfwLsu0GVqi5asegCNiyQ2FCkgqIiVC4toYtCEijNDYckbjKO7x57xjOe72OR0lA1Z3n0nkdH57yvwj4lg0BWWi5OIDFCOjEzRNzUlP20jzRn59bEj1ZHGRrLMZo0iZo6dV+wVbDkq/k0I9mU+n+9CiB7rnA2fhNnL38nTl2eIzBUJswG6XQUI2wQT4RZN8J8fWuWO7/MCK/VFP8BdIDe1iqlC8fJ1Cc5OzxJ/qtPKJy5SFqA4guW6y5rTYVkXcMcmGHlm18Jum2hmTF1F9CwMHqbvJ0o4VevUWYUZ/Emtt+hOvIMDUVF74txx08jDY2B7Dzd+u29DYK7V/Cq4CPBDJPKCA6sfcuXFZ0V5RBus0Op1mWhYPNDT/L+sQDJ0i5AdhuyfP51elIB04BonMhglkvJ01xPvURiaYfSYkFWKk20Ro2D412k61Nenb0P8Fz8WgNCBr4Wpni7xNXWu1x5Ooe0a/R8H2E16d7bJOQ7PDFcQqHBcuH+EaXU6bR0BCqi1yMTl7yZ+4uS8yeDTp2JrMNnkTF+qtq8mLSIe0X8cpHD+fTuG7VkvyIyU6K17YhIQhO5pzQxVrnGh1sf8V7lHJ35BUr36girw6mxP+gPVnBX/yYcfWXviKnpkyx+8TmhtIeeHyDcp3JjcZBLGy9zqxEH9wbvHPF5a3ydTnGbwpxCdmJqz4lB1w1ufnCS8s9XOTSdIpaNqkZUZ7OV5B+rzWOxshzP2+jpBJ7dwkq9wdEzM+pDVq6vF4LvT59ALc6Tfy6qJh+PYkYEIc1D+J5UwgI9KRC5F0gf/xQjM6k+sDJAdChP/uOL2EePsbnQYWe+TGejil+zwfOw3R5z1jTbT557MPxImFrtdnB3aQlr9rrK8u+E3R3UWATlQL9k+Ah9h1/j2eenHgrTvhFtu13Zats4jgsSRkeG9tUB/AvjNVepPwFrSQAAAABJRU5ErkJggg==";

function broadcast(topic, payload)
{
  // we need to broadcast to all ports connected to this shared worker
  for (var i = 0; i < _broadcastReceivers.length; i++) {
  	log("about to broadcast to " + _broadcastReceivers[i]);
	_broadcastReceivers[i].postMessage({topic: topic, data: payload});
  }
}

function broadcastStateChange(isConnected, port) {
  var topic = "mqtt.connected";
  if (port) {
	port.postMessage({topic: topic, data: isConnected});
  } else {
	broadcast(topic, isConnected);
  }
}

// Messages from the sidebar and chat windows:
var handlers = {
	// notify the other windows of some interesting development:
	inform: function(port, data) {
		broadcast(data.type, data.message);
	},
	checkconnection: function(port, data) {
		if (gSavedUserProfile && gSocket) {
			port.postMessage({topic:"checkconnectionack", data:gSavedUserProfile});
		}
	},
	connect: function(port, data) {
		var assertion = data.assertion;
		createSocket(assertion);
	},
	reconnect: function(port, data) {
		var assertion = data.assertion;
		createSocket(assertion);
	},
	getusers: function(port, data) {
		// if we have the user list cached, return that
		gSocket.send(JSON.stringify( {cmd: "getusers"}));
	},
	shownotification: function(port, data) {
		Notification(data.icon, data.title, data.text).show();
	},
	'social.user-recommend': function(port, data) {
		log("demosocial got recommend request for " + data.url);
	},
	'social.user-recommend-prompt': function(port, data) {
	// XXX - I guess a real impl would want to check if the URL has already
	// been liked and change this to "unlike" or similar?
		port.postMessage({topic: 'social.user-recommend-prompt-response',
					  data: {
						message: "Recommend to DemoSocialService",
						img: RECOMMEND_ICON
					  }
					 });
	},
	heartbeat: function(port, data) {
		heartbeat();
	},
	sendmessage: function(port, data) {
		gSocket.send(JSON.stringify( 
			{
				cmd: "sendmessage", 
				from: gSavedUserProfile.id,
				to: data.to,
				msg: data.msg
			}
		));
	},
	useractivity: function(port, data) {
		gSocket.send(JSON.stringify(
		{
			cmd:"useractivity",
			from: gSavedUserProfile.id,
			to: data.to,
			msg: data.msg
		}));
	},
	video: function(port, data) {
		gSocket.send(JSON.stringify(
			{
				cmd: "video",
				from: gSavedUserProfile.id,
				to: data.to,
				msg: data.msg
			}
		));
	}	
}




var gSocket;
var gSavedUserProfile;

function createSocket(assertion)
{
	log("Creating socket");
	var socket = new WebSocket("ws://demosocialservice.org:8888/websocket");
	socket.onopen = function() {
		log("Socket open, sending assertion");
		socket.send( JSON.stringify( {cmd: "connect", assertion:assertion} ));
	}
	socket.onclose = function() {
		log("Socket close");
		broadcast("connectionclose");
		gSocket = null;
	}
	socket.onmessage = function(msg) {
		log("Socket message: " + msg.data)
		var cmdMsg = JSON.parse(msg.data);
		if (socketMessageHandlers[cmdMsg.cmd]) {
			socketMessageHandlers[cmdMsg.cmd](cmdMsg);
		}
	}
	socket.onerror = function(err) {
		log("Socket error " + err.code);
		gSocket = null;
	}	
	gSocket = socket;
}

// Messages from the server:
socketMessageHandlers = {
	connack: function(msg) {
		gSavedUserProfile = msg;
		broadcast("connack", msg);

		// get a list of users:
		if (msg.status == "ok") {
			gSocket.send(JSON.stringify( {cmd: "getusers"}));
		}
	},
	getusersresp: function(msg) {
		broadcast("getusersresp", msg);
	},
	presenceupdate: function(msg) {
		broadcast("presenceupdate", msg);
	},
	newmessage: function(msg) {
		broadcast("newmessage", msg);
	},
	video: function(msg) {
		broadcast("video", msg);
	},
	useractivity: function(msg) {
		broadcast("useractivity", msg);
	}
}

function heartbeat() {
	log("heartbeat - socket is " + gSocket);
	if (gSocket) gSocket.send(JSON.stringify( {cmd:"heartbeat"} ));
}