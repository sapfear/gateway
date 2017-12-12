var xml2js = require('xml2js');
var modbus = require('jsmodbus');

const UDP_LISTENING_PORT = 7751;
const REGISTER_READ_OFFSET = 0;
const REGISTER_WRITE_OFFSET = 0;
const REREAD_TIMEOUT = 1000 * 20; //10 secs
const MongoClient    = require('mongodb').MongoClient;
var dgram = require('dgram');
var client = dgram.createSocket('udp4');

var main_modbus_addr = '';
var main_modbus_port = 0;
var modbus_slave_id = 0;
var main_loop, modbus_up;
var debug = true, debug_addr = '192.168.7.2';
var modbus_client, modbus_client_online_status = false;
var mongo_url = "mongodb://localhost:27017/test_2";
var mongo_db_instance = null, mongo_client_online_status = false;

var mongoConnect = function(delay){
	setTimeout(function(){
		MongoClient.connect(mongo_url, {
		        reconnectTries: 60, // retry to connect for 60 times
		        reconnectInterval: 1000 // wait 1 second before retrying
		    }, function(err, db) {
			mongo_client_online_status = (err == null);
			console.log('mongo_connection established: ' + mongo_client_online_status);
			mongo_db_instance = db;
			if(!mongo_client_online_status){
				mongoConnect(delay);
			} else {
    			mongo_db_instance.s.topology.on('close', () => mongo_client_online_status = false );
    			mongo_db_instance.s.topology.on('reconnect', () => mongo_client_online_status = true );
			}
		});
		
	}, delay)
}
mongoConnect(1000);

var getRegistrValueStr = function(buffer, number, length){
	return buffer.slice(number*2, number*2 + length).toString().replace(/\0/g, '');
};

var getRegistrValueUInt16 = function(buffer, number){
	return buffer.readUIntBE(number*2, 2);
};

var getRegistrValueUInt32 = function(buffer, number){
	return buffer.readUIntBE(number*2, 4);
};

var getRegistrValueUInt64 = function(buffer, number){
	return buffer.readUIntBE(number*2, 8);
};

var getBufferFromUInt16 = function(number){
	var buf = new Buffer.alloc(2);
	buf.writeIntBE(number, 0, 2);
	return buf;
}

var getBufferFromUInt32 = function(number){
	var buf = new Buffer.alloc(4);
	buf.writeIntBE(number, 0, 4);
	return buf;
}

var getBufferFromUInt64 = function(number){
	var buf = new Buffer.alloc(8);
	buf.writeIntBE(number, 0, 8);
	return buf;
}

var getBufferFromStr = function(str, length){
	var buf = new Buffer.alloc(length);
	buf.write(str, 0, 'ascii');
	return buf;
};

var writeMultiplyRegisters = function(data, registr_start){
	modbus_client.writeMultipleRegisters(REGISTER_WRITE_OFFSET + registr_start, Buffer.concat(data)).then(function (resp) {
        
        // resp will look like { fc : 16, startAddress: 4, quantity: 4 }
        console.log(resp);
        
    }, console.error);
}

var getConnectorFaultcode = function(status_id){
	switch(+status_id){
		case 0: return 'NoError'; break;
		case 1: return 'OtherError'; break;
		case 2: return 'ConnectorLockFailure'; break;
		case 3: return 'GroundFailure'; break;
		case 4: return 'HighTemperature'; break;
		case 5: return 'Mode3Error'; break;
		case 6: return 'OverCurrentFailure'; break;
		case 7: return 'PowerMeterFailure'; break;
		case 8: return 'PowerSwitchFailure'; break;
		case 9: return 'ReaderFailure'; break;
		case 10: return 'ResetFailure'; break;
		case 11: return 'UnderVoltage'; break;
		case 12: return 'WeakSignal'; break;
		default: return 'NoError';
	}
}

var getConnectorStatus = function(status_id){
	switch(+status_id){
		case 0: return 'Unavailable'; break;
		case 1: return 'Available'; break;
		case 2: return 'Occupied'; break;
		case 3: return 'Reserved'; break;
		default: return 'Available';
	}
}

modbus_up = function(host, port, callback){
	console.log('MODBUS ADDR: ' + host);
	console.log('MODBUS PORT: ' + port);
	modbus_client = modbus.client.tcp.complete({ 
        'host'              : host, 
        'port'              : port,
        'autoReconnect'     : true,
        'reconnectTimeout'  : 5000,
        'timeout'           : 30*1000,
        'unitId'            : 1
	});
	
	modbus_client.connect();
	
	modbus_client.on('connect', function () {
		console.log('Client opened');
		modbus_client_online_status = true;
	});
	
	modbus_client.on('error', function (err) {
	    console.log(err);
	});
	
	modbus_client.on('close', function () {
		console.log('Client closed');
		modbus_client_online_status = false;
	});
	
	main_loop(1000);
}

client.on('listening', function () {
	var address = client.address();
	console.log('UDP Client listening on ' + address.address + ":" + address.port);
	client.setBroadcast(true)
	client.setMulticastTTL(128); 
	client.addMembership('224.1.1.1');
});

client.on('message', function (message, remote) {
	if(!!main_modbus_addr && !!main_modbus_port)
		return;
	
	console.log(message);
	
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
					
					modbus_up(main_modbus_addr, main_modbus_port, function(){
						main_loop(2000);
					});
					//process.exit()
				}
			}
		}
	});
	
});

main_loop = function(delay){
	//console.log('IDLE: modbus_client_online_status: ' + modbus_client_online_status);
	//console.log('IDLE: mongo_client_online_status: ' + mongo_client_online_status);
	
	//writeMultiplyRegisters([getBufferFromUInt32(555)], 71);
	
	
	var read_modbus_function_name = (false) ? 'readHoldingRegisters' : 'readInputRegisters'; //(!!debug) ? 'readHoldingRegisters' : 'readInputRegisters';
	
	if(modbus_client_online_status == true && mongo_client_online_status == true) modbus_client[read_modbus_function_name](REGISTER_READ_OFFSET + 0, 11).then(function (resp) {
		
		var current_time = new Date().getTime();
		// resp will look like { fc: 4, byteCount: 20, register: [ values 0 - 10 ], payload: <Buffer> }
		//console.log(resp);
		console.log(resp.payload);
		console.log(getRegistrValueStr(resp.payload, 0, 20));
	    console.log('AUTH_CMD: ' + !!getRegistrValueUInt16(resp.payload, 10));
		return;

		var result_object = {
	    	AUTH_IDTAG: getRegistrValueStr(resp.payload, 0, 20),
	    	AUTH_CMD: !!getRegistrValueUInt16(resp.payload, 10),
	    	
	    	BN_PLC_RUNNING: !!getRegistrValueUInt16(resp.payload, 13),
	    	BN_PLC_SW_VERSION: getRegistrValueStr(resp.payload, 14, 16),
	    	BN_EVCHST_MODEL: getRegistrValueStr(resp.payload, 22, 16),
			BN_CS_DATETIME: 0,
			BN_EVCHST_ACCEPTED: -1,
	    	
	    	MV_CONNECTOR1_WHMETER: getRegistrValueUInt32(resp.payload, 39),
	    	MV_CONNECTOR2_WHMETER: getRegistrValueUInt32(resp.payload, 41),
	    	MV_CONNECTOR1_ACTPOW: getRegistrValueUInt32(resp.payload, 43),
	    	MV_CONNECTOR2_ACTPOW: getRegistrValueUInt32(resp.payload, 45),
	    	MV_CONNECTOR1_VOLTAGE: getRegistrValueUInt32(resp.payload, 47),
	    	MV_CONNECTOR2_VOLTAGE: getRegistrValueUInt32(resp.payload, 49),
	    	MV_CONNECTOR1_CURRENT: getRegistrValueUInt32(resp.payload, 51),
	    	MV_CONNECTOR2_CURRENT: getRegistrValueUInt32(resp.payload, 53),
	    	
	    	START_CONNECTOR_ID: getRegistrValueUInt16(resp.payload, 55),
	    	START_WHMETER: getRegistrValueUInt32(resp.payload, 56),
	    	START_IDTAG: getRegistrValueStr(resp.payload, 58, 20),
	    	START_CMD: !!getRegistrValueUInt16(resp.payload, 68),
			START_ACCEPTED: -1,
			START_TRANSACTION_ID: -1,
	    	
	    	SN_CON1_FAULTCODE: getRegistrValueUInt16(resp.payload, 73),
	    	SN_CON2_FAULTCODE: getRegistrValueUInt16(resp.payload, 74),
	    	SN_CON1_STATUS: getRegistrValueUInt16(resp.payload, 75),
	    	SN_CON2_STATUS: getRegistrValueUInt16(resp.payload, 76),
	    	SN_CON1_CMD: !!getRegistrValueUInt16(resp.payload, 77),
	    	SN_CON2_CMD: !!getRegistrValueUInt16(resp.payload, 78),
	    	SN_CON1_COMPLETE: -1,
	    	SN_CON2_COMPLETE: -1,
	    	
	    	STOP_CONNECTOR_ID: getRegistrValueUInt16(resp.payload, 81),
	    	STOP_WHMETER: getRegistrValueUInt32(resp.payload, 82),
	    	STOP_IDTAG: getRegistrValueStr(resp.payload, 84, 20),
	    	STOP_TRANSACTION_ID: getRegistrValueUInt32(resp.payload, 94),
	    	STOP_CMD: !!getRegistrValueUInt16(resp.payload, 96),
			STOP_COMPLETE: -1
	    }
	    
	    var result_write = {};
	    
	    //console.log(result_object);
	    
	    
		var throw_callback = function(err, result) {
			if(!!err){
				//mongo_db_instance.close();
				//mongoConnect(1000);
				mongo_client_online_status = false;
				return true;
			}
			return false
			//if (err) throw err;
		}
		//TAG AUTH
		mongo_db_instance.collection("tag_requests").findOne({}, function(err, old_state) {
			if (throw_callback(err))
				return;
				
			var auth_result_write = [];
			
			if(result_object.AUTH_CMD == true){
				
				if(!!old_state && !!old_state.AUTH_COMPLETE && result_object.AUTH_IDTAG == old_state.AUTH_IDTAG && old_state.STATUS == 'ReceivedFromOCPP' && old_state.TIME+REREAD_TIMEOUT >= current_time){
					//need write answer to modbus
					auth_result_write = [getBufferFromUInt16(old_state.AUTH_COMPLETE), getBufferFromUInt16(old_state.AUTH_IDTAG_ACCEPTED)];
					
					console.log(auth_result_write);
				} else {
					if(!!old_state && (old_state.STATUS == "ReceivedFromModbus" || old_state.STATUS == "TransmittedToOCPP" ) ){
						console.log('not need write to DB');
					} else {
						//need write request to DB again
						console.log('need write to DB again');
						var new_state = {
							AUTH_IDTAG: result_object.AUTH_IDTAG,
							STATUS: 'ReceivedFromModbus',
							TIME: current_time
						}
						
						if(old_state != null && !!old_state._id){
							mongo_db_instance.collection("tag_requests").updateOne({_id: old_state._id}, new_state, throw_callback);
						} else {
							mongo_db_instance.collection("tag_requests").insertOne(new_state, throw_callback);
						}
					}
				}
			} else {
				console.log('AUTH_CMD == false');
				auth_result_write = [getBufferFromUInt16(0), getBufferFromUInt16(0)];
			}
			writeMultiplyRegisters(auth_result_write, 11);
		});
		
		//BOOT NOTIFICATION
		mongo_db_instance.collection("boot_notification_state").findOne({}, function(err, old_state) {
			if (throw_callback(err))
				return;
			var new_state = {}
			if (!!result_object.BN_PLC_RUNNING){
				new_state = {
					BN_PLC_RUNNING: result_object.BN_PLC_RUNNING,
			    	BN_PLC_SW_VERSION: result_object.BN_PLC_SW_VERSION,
			    	BN_EVCHST_MODEL: result_object.BN_EVCHST_MODEL
				}
			} else {
				new_state = {
					BN_PLC_RUNNING: result_object.BN_PLC_RUNNING,
			    	BN_PLC_SW_VERSION: '',
			    	BN_EVCHST_MODEL: '',
			    	BN_CS_DATETIME: '',
			    	BN_EVCHST_ACCEPTED: '' 
				}
			}
			
			var boot_result_write = [getBufferFromUInt64(!!old_state ? old_state.BN_CS_DATETIME : 0), getBufferFromUInt16(!!old_state ? old_state.BN_EVCHST_ACCEPTED : 0)];
						
			if(old_state != null && !!old_state._id){
				mongo_db_instance.collection("boot_notification_state").updateOne({_id: old_state._id}, { $set: new_state }, throw_callback);
			} else {
				mongo_db_instance.collection("boot_notification_state").insertOne(new_state, throw_callback);
			}
			writeMultiplyRegisters(boot_result_write, 30);
			//console.log(result_write);
		});
		
		//METER VALUES
		mongo_db_instance.collection("meter_values").findOne({}, function(err, old_state) {
			if (throw_callback(err))
				return;
			var new_state = {
				MV_CONNECTOR1_WHMETER: result_object.MV_CONNECTOR1_WHMETER,
		    	MV_CONNECTOR2_WHMETER: result_object.MV_CONNECTOR2_WHMETER,
		    	MV_CONNECTOR1_ACTPOW: result_object.MV_CONNECTOR1_ACTPOW,
		    	MV_CONNECTOR2_ACTPOW: result_object.MV_CONNECTOR2_ACTPOW,
		    	MV_CONNECTOR1_VOLTAGE: result_object.MV_CONNECTOR1_VOLTAGE,
		    	MV_CONNECTOR2_VOLTAGE: result_object.MV_CONNECTOR2_VOLTAGE,
		    	MV_CONNECTOR1_CURRENT: result_object.MV_CONNECTOR1_CURRENT,
		    	MV_CONNECTOR2_CURRENT: result_object.MV_CONNECTOR2_CURRENT,
			}
						
			if(old_state != null && !!old_state._id){
				mongo_db_instance.collection("meter_values").updateOne({_id: old_state._id}, new_state, throw_callback);
			} else {
				mongo_db_instance.collection("meter_values").insertOne(new_state, throw_callback);
			}
		});
		
		//START TRANSACTION
		mongo_db_instance.collection("start_transaction").findOne({}, function(err, old_state) {
			if (throw_callback(err))
				return;
			var start_transaction_result_write = [];
			if(result_object.START_CMD == true){
				console.log('START_CMD == true');
				if(!!old_state && !!old_state.START_COMPLETE && result_object.START_IDTAG == old_state.START_IDTAG && old_state.STATUS == 'ReceivedFromOCPP' && old_state.TIME+REREAD_TIMEOUT >= current_time){
					//need write answer to modbus
					start_transaction_result_write = [
						getBufferFromUInt16(1),
						getBufferFromUInt16(old_state.START_ACCEPTED),
						getBufferFromUInt32(old_state.START_TRANSACTION_ID)
					]
				} else {
					if(!!old_state && old_state.STATUS == "ReceivedFromModbus"){
						console.log('not need write to DB');
					} else {
						//need write request to DB again
						console.log('need write to DB again');
						var new_state = {
							START_CONNECTOR_ID: result_object.START_CONNECTOR_ID,
							START_WHMETER: result_object.START_WHMETER,
							START_IDTAG: result_object.START_IDTAG,
							STATUS: 'ReceivedFromModbus',
							TIME: current_time
						}
						
						if(old_state != null && !!old_state._id){
							mongo_db_instance.collection("start_transaction").updateOne({_id: old_state._id}, new_state, throw_callback);
						} else {
							mongo_db_instance.collection("start_transaction").insertOne(new_state, throw_callback);
						}
					}
				}
			} else {
				if(old_state != null && !!old_state._id){
					mongo_db_instance.collection("start_transaction").remove( {_id: old_state._id}, throw_callback)
				}
				
				console.log('START_CMD == false');
				start_transaction_result_write = [
					getBufferFromUInt16(0),
					getBufferFromUInt16(0),
					getBufferFromUInt32(0)
				]
			}
			
			writeMultiplyRegisters(start_transaction_result_write, 69);
		});
		
		//STATUS NOTIFICATION
	    if(result_object.SN_CON1_CMD == true){
	    	console.log('SN_CON1_CMD == 1');
	    	mongo_db_instance.collection("status_notifications").insertOne({
	    		CONNECTOR_ID: 1,
	    		SN_CON_FAULTCODE: getConnectorFaultcode(result_object.SN_CON1_FAULTCODE),
	    		SN_CON_STATUS: getConnectorStatus(result_object.SN_CON1_FAULTCODE),
	    		STATUS: 'ReceivedFromModbus'
	    	}, function(err, insert_result){
				if (throw_callback(err))
					return;
				writeMultiplyRegisters([getBufferFromUInt16(1)], 79);
	    	});
	    }
	    if(result_object.SN_CON2_CMD == true){
	    	console.log('SN_CON2_CMD == 1');
	    	mongo_db_instance.collection("status_notifications").insertOne({
	    		CONNECTOR_ID: 2,
	    		SN_CON_FAULTCODE: getConnectorFaultcode(result_object.SN_CON2_FAULTCODE),
	    		SN_CON_STATUS: getConnectorStatus(result_object.SN_CON2_FAULTCODE),
	    		STATUS: 'ReceivedFromModbus'
	    	}, function(err, insert_result){
				if (throw_callback(err))
					return;
				writeMultiplyRegisters([getBufferFromUInt16(1)], 80);
	    	});
	    }
		
	    //STOP TRANSACTION
		var stop_transaction_result_write = [];
	    if(result_object.STOP_CMD == true){
			console.log('STOP_CMD == true');
			mongo_db_instance.collection("stop_transactions").findOne({STOP_TRANSACTION_ID: result_object.STOP_TRANSACTION_ID}, function(err, old_state) {
				if (throw_callback(err))
					return;
				if(old_state != null && !!old_state._id){
					//FINDED STOP_TRANSACTION_ID
					if(old_state.STATUS == 'ReceivedFromOCPP'){
						stop_transaction_result_write = [getBufferFromUInt16(1)];
						writeMultiplyRegisters(stop_transaction_result_write, 97);
					} else {
						//wait response
					}
				} else {
					var new_state = {
						STOP_CONNECTOR_ID: result_object.STOP_CONNECTOR_ID,
						STOP_WHMETER: result_object.STOP_WHMETER,
						STOP_IDTAG: result_object.STOP_IDTAG,
						STOP_TRANSACTION_ID: result_object.STOP_TRANSACTION_ID,
						STATUS: 'ReceivedFromModbus',
						TIME: current_time
					}
					mongo_db_instance.collection("stop_transactions").insertOne(new_state, throw_callback);
				}
			});
		} else {
			console.log('STOP_CMD == false');
			stop_transaction_result_write = [getBufferFromUInt16(0)]
			writeMultiplyRegisters(stop_transaction_result_write, 97);
		}
		
		mongo_db_instance.collection("reserve_state").find(
			{
				STATUS: 'ReceivedFromOCPP',
				$or:[
					{ CONNECTOR_ID: '1' },
					{ CONNECTOR_ID: '2' }
				]
			}
		).sort({ _id: -1 }).limit(2).toArray( function(err, old_state) {
			if (throw_callback(err))
				return;
			//console.log("reserve_state");
			//console.log(old_state);
			if (!!old_state) for(i = 0; i < old_state.length; i++ ){
				var values = old_state[i];					
					
				var reservenow_result_write = [
					getBufferFromStr(values.RESERV_CON_IDTAG, 20),
					getBufferFromUInt32(values.RESERV_CON_RESID),
					getBufferFromUInt64(values.RESERV_CON_DATETIME),
					getBufferFromUInt16(values.RESERV_CON_CMD)
				];
				
				mongo_db_instance.collection("reserve_state").updateOne({_id: values._id}, { $set: {STATUS: 'TransmittedToModbus'} }, function(err, res){
					if (throw_callback(err))
						return;
					switch(values.CONNECTOR_ID+''){
						case '1':
							writeMultiplyRegisters(reservenow_result_write, 98);
						break;
						case '2':
							writeMultiplyRegisters(reservenow_result_write, 115);
						break;
					}					
				});
				
			}
		});
		mongo_db_instance.collection("availability_state").find(
			{
				STATUS: 'ReceivedFromOCPP',
				$or:[
					{ CONNECTOR_ID: '1' },
					{ CONNECTOR_ID: '2' }
				]
			}
		).sort({ _id: -1 }).limit(2).toArray( function(err, old_state) {
			if (throw_callback(err))
				return;
			//console.log("availability_state");
			//console.log(old_state);
			if (!!old_state) for(i = 0; i < old_state.length; i++ ){
				var values = old_state[i];
				mongo_db_instance.collection("availability_state").updateOne({_id: values._id}, { $set: {STATUS: 'TransmittedToModbus'} }, function(err, res){
					if (throw_callback(err))
						return;
					switch(values.CONNECTOR_ID+''){
						case '1':
							writeMultiplyRegisters([getBufferFromUInt16(values.CAN_CHARGE)], 134);
							writeMultiplyRegisters([getBufferFromUInt16(values.CAN_CHARGE)], 136);
						break;
						case '2':
							writeMultiplyRegisters([getBufferFromUInt16(values.CAN_CHARGE)], 135);
							writeMultiplyRegisters([getBufferFromUInt16(values.CAN_CHARGE)], 137);
						break;
					}					
				});
				
			}
		});
		mongo_db_instance.collection("lock_state").find(
			{
				STATUS: 'ReceivedFromOCPP',
				$or:[
					{ CONNECTOR_ID: '1' },
					{ CONNECTOR_ID: '2' }
				]
			}
		).sort({ _id: -1 }).limit(2).toArray( function(err, old_state) {
			if (throw_callback(err))
				return;
			if (!!old_state) for(i = 0; i < old_state.length; i++ ){
				var values = old_state[i];
				mongo_db_instance.collection("lock_state").updateOne({_id: values._id}, { $set: {STATUS: 'TransmittedToModbus'} }, function(err, res){
					if (throw_callback(err))
						return;
					switch(values.CONNECTOR_ID+''){
						case '1':
							writeMultiplyRegisters([getBufferFromUInt16(values.CAN_LOCK)], 132);
						break;
						case '2':
							writeMultiplyRegisters([getBufferFromUInt16(values.CAN_LOCK)], 133);
						break;
					}					
				});
				
			}
		});
		
		mongo_db_instance.collection("stop_requests").findOne({
			STATUS: 'ReceivedFromOCPP'
		}, function(err, old_state) {
			if (throw_callback(err))
				return;
			if (!!old_state) {
				if(!!old_state.TRANSACTION_ID){
					var stop_result_write = [
						getBufferFromUInt32(old_state.TRANSACTION_ID)
					];
					
					mongo_db_instance.collection("stop_requests").updateOne({_id: old_state._id}, { $set: {STATUS: 'TransmittedToModbus'} }, function(err, res){
						if (throw_callback(err))
							return;
						writeMultiplyRegisters(stop_result_write, 200);				
					}); 
				} else {
					mongo_db_instance.collection("start_requests").updateOne({_id: old_state._id}, { $set: {STATUS: 'FieldsError'} }, throw_callback);
				}
			}
		});
		
		mongo_db_instance.collection("start_requests").findOne({
			STATUS: 'ReceivedFromOCPP'
		}, function(err, old_state) {
			if (throw_callback(err))
				return;
			//console.log("reserve_state");
			//console.log(old_state);
			if (!!old_state) {
				if(!!old_state.TAG_ID && !!old_state.CONNECTOR_ID){
					var start_result_write = [
						getBufferFromStr(old_state.TAG_ID, 20),
						getBufferFromUInt32(old_state.CONNECTOR_ID)
					];
					
					mongo_db_instance.collection("start_requests").updateOne({_id: old_state._id}, { $set: {STATUS: 'TransmittedToModbus'} }, function(err, res){
						if (throw_callback(err))
							return;
						switch(old_state.CONNECTOR_ID+''){
							case '1':
								writeMultiplyRegisters(start_result_write, 202);
							break;
							case '2':
								writeMultiplyRegisters(start_result_write, 202);
							break;
						}					
					});
				} else {
					mongo_db_instance.collection("start_requests").updateOne({_id: old_state._id}, { $set: {STATUS: 'FieldsError'} }, throw_callback);
				}
			}
		});
		
	
    }, console.error);
	
	setTimeout(function(){
		main_loop(delay);
	}, delay);
}

if(!debug){
	client.bind(UDP_LISTENING_PORT);
} else {
	//modbus_up('192.168.2.92', 502);
	modbus_up(debug_addr, 502);
}