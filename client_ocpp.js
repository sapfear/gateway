var OCPP = require('./lib/ocpp-protocol.js'),
    Simulators = require('./lib/simulators.js'),
    Transport = require('./lib/transport.js'),
    Plugins = require('./lib/plugins.js');
const MongoClient    = require('mongodb').MongoClient;
	
OCPP.readWSDLFiles();
OCPP.buildJSONSchemas();

var server_url = 'http://localhost:9000/';
var identifier = 'box_1';
var protocol = 'ocpp1.5';
var fromHeader = '';

Transport.retrieveIPAddress();

var cp = new Simulators.ChargePointSimulator(
	server_url, identifier, protocol, 'websocket',
	//server_url, identifier, protocol, 'soap',
	{
		fromHeader: fromHeader,
		remoteActionPort: Transport.retrievePort(fromHeader)
	}
);

Simulators.chargePoints[cp.chargePointId] = cp;
  
setTimeout(function(){
	console.log("Plugin start load");
	Plugins.load('cp');
	Plugins.plugins.cp.connected = !!cp.clientConnection;
	//console.log(Plugins.plugins.cp);
	
	
}, 1000);



















