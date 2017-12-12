var xml2js = require('xml2js');

var PORT = '7751' ;
var dgram = require('dgram');
var client = dgram.createSocket('udp4');

var main_modbus_addr = '';
var main_modbus_port = 0;
var modbus_slave_id = 0;

client.on('listening', function () {
	var address = client.address();
	console.log(address);
	console.log('UDP Client listening on ' + address.address + ":" + address.port);
	client.setBroadcast(true)
	client.setMulticastTTL(128); 
	client.addMembership('224.1.1.1');
});

client.on('message', function (message, remote) {   
	//console.log('A: Epic Command Received. Preparing Relay.');
	//console.log('B: From: ' + remote.address + ':' + remote.port +' - ' + message);
	
	xml2js.parseString(message, function (err, result) {
		if(!err && !!result && !!result['ns:pdu'] && !!result['ns:pdu']['hw_agent']){
			var hw_agent = result['ns:pdu'].hw_agent[0];
			var type = hw_agent.$.type;
			if(type == 'other.EVChargeControl'){
				var protocols = hw_agent.protocols;
				if(!!protocols && !!protocols[0] && !!protocols[0].modbus_tcp && !!protocols[0].modbus_tcp[0]){
					var modbus_node = protocols[0].modbus_tcp[0];
					
					if(!!modbus_node.transports && !!modbus_node.transports[0] && !!modbus_node.transports[0].tcp && !!modbus_node.transports[0].tcp[0] && !!modbus_node.transports[0].tcp[0].port && !!modbus_node.transports[0].tcp[0].port[0]){
						main_modbus_port = +modbus_node.transports[0].tcp[0].port[0];
						main_modbus_addr = remote.address;
					}
					if(!!modbus_node.slave_id && !!modbus_node.slave_id[0]){
						modbus_slave_id = modbus_node.slave_id[0];
					}
					
					console.log( 'MODBUS CONNECT DATA:' );
					console.log( 'ADDR:  ' + main_modbus_addr );
					console.log( 'PORT:  ' + main_modbus_port );
					console.log( 'SLAVE: ' + modbus_slave_id );
					process.exit()
				}
			}
		}
	});
	
});

client.bind(PORT);