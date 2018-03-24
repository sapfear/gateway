var xml2js = require('xml2js');
var modbus = require('jsmodbus');

const UDP_LISTENING_PORT = 7751;
const REGISTER_READ_OFFSET = 200;
const REGISTER_WRITE_OFFSET = 0;
const REREAD_TIMEOUT = 1000 * 20; //20 secs
const MongoClient    = require('mongodb').MongoClient;
const MAIN_LOOP_TIMEOUT = 500;
const UNLOCK_TIMEOUT = 1000;
var dgram = require('dgram');
var client = dgram.createSocket('udp4');

var main_modbus_addr = '';
var main_modbus_port = 0;
var modbus_slave_id = 0;
var main_loop, modbus_up, mosbus_init;
//var debug = true, debug_addr = '192.168.0.104';
var debug = true, debug_addr = '192.168.7.2';
//var debug = true, debug_addr = '192.168.2.92';
var modbus_client, modbus_client_online_status = false;
var mongo_url = "mongodb://localhost:27017/test_2";
var mongo_db_instance = null, mongo_client_online_status = false;

var register_map_read = {}, register_map_write = {};

const isLittleEndian = true;

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

var read_configs = function(){
	var lines = require('fs').readFileSync(__dirname + '/config/regs_4.csv', 'utf-8')
		.split('\n')
		.filter(Boolean);
		
	if(lines.length === 1)
		lines = require('fs').readFileSync(__dirname + '/config/regs_4.csv', 'utf-8')
		.split('\r')
		.filter(Boolean);
	
	for(i = 0; i < lines.length; i++){
		var splitted_line = lines[i].split(';');
		if(!!splitted_line && !!splitted_line[0] && !!splitted_line[2] && !!splitted_line[3] && !!splitted_line[4] && ['IN', 'OUT'].indexOf(splitted_line[3]) != -1){
			if(splitted_line[3] == 'OUT')
				register_map_read[splitted_line[0]] = {
					startAddress: +splitted_line[4],
					length: +splitted_line[2]
				};
			else
				register_map_write[splitted_line[0]] = {
					startAddress: +splitted_line[4],
					length: +splitted_line[2]
				};
		}
	}
	
	mongoConnect(1000);
}

read_configs();

var getRegistrValueStr = function(buffer, number, length){
	const buffer_str = buffer.slice(number*2, number*2 + length);

	if(!!isLittleEndian ) buffer_str.swap16();
	
	return buffer_str.toString().replace(/\0/g, '');
};

var getRegistrValueUIntX = function(buffer, number, length){
	const buffer_int = buffer.slice(number*2, number*2 + length * 2)

	if(!!isLittleEndian) buffer_int.swap16();
	if(!!isLittleEndian && length == 8) buffer_int.swap32().swap64();
	
	return buffer_int.readUIntLE(0, length * 2);
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

var getRegValue = function(buffer, name, offset){
	var reg_obj = register_map_read[name];
	if(!reg_obj)
		return null;
	
	switch(reg_obj.length){
		case 1:
		case 2:
		case 4:
			return getRegistrValueUIntX(buffer, reg_obj.startAddress - offset, reg_obj.length);
		break;
		default:
			return getRegistrValueStr(buffer, reg_obj.startAddress - offset, reg_obj.length*2);
		break;
	}
}

var getBufferFromUIntX = function(number, len){
	var buf = new Buffer.alloc(2*len);
	buf.writeIntLE(number, 0, 2*len);

	if(!!isLittleEndian && len == 8 ) buf.swap64().swap32();
	if(!!isLittleEndian ) buf.swap16();
	
	return buf;
}

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
	if(!!isLittleEndian ) buf.swap16();
	return buf;
};

var getBufferFromDatetime = function(value, length){
    var date = new Date(value);
    var buf = new Buffer([
        date.getMinutes(),
        date.getSeconds(),
        0,
        date.getHours(),
        date.getMonth() + 1,
        date.getDate(),
        (date.getFullYear() >>> 8) & 0xFF,
        date.getFullYear() & 0xFF
    ]);
    return buf;
}

var writeRegister = function(name, value){
	var reg_obj = register_map_write[name];
	if(!reg_obj)
		return null;
	var buf;
	
	if(name.indexOf('_DATETIME') != -1){
		//console.log(name);
		//console.log(new Date(value));
		//console.log(getBufferFromDatetime(value, reg_obj.length));
		buf = getBufferFromDatetime(value, reg_obj.length);
	} else {
		switch(reg_obj.length){
			case 1:
			case 2:
			case 4:
				buf = getBufferFromUIntX(value, reg_obj.length);
			break;
			default:
				buf = getBufferFromStr(value, reg_obj.length*2);
			break;
		}
	}
	
	modbus_client.writeMultipleRegisters(reg_obj.startAddress + REGISTER_WRITE_OFFSET, buf).then(function (resp) {

    }, console.error);
}

var writeMultiplyRegisters = function(data, registr_start){
	modbus_client.writeMultipleRegisters(REGISTER_WRITE_OFFSET + registr_start, Buffer.concat(data)).then(function (resp) {
        
        // resp will look like { fc : 16, startAddress: 4, quantity: 4 }
        //console.log(resp);
        
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
	
	mosbus_init(1000);
	
	main_loop(MAIN_LOOP_TIMEOUT);
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
						main_loop(MAIN_LOOP_TIMEOUT);
					});
					//process.exit()
				}
			}
		}
	});
	
});

mosbus_init = function(delay){
	if(modbus_client_online_status == true){

		writeRegister('CONTROL_CON1_LOCK_ALLOW', 1);
		writeRegister('CONTROL_CON1_AUTH_ALLOW', 1);
		writeRegister('CONTROL_CON1_CHARGING_ALLOW', 1);
		
		writeRegister('CONTROL_CON2_LOCK_ALLOW', 1);
		writeRegister('CONTROL_CON2_AUTH_ALLOW', 1);
		writeRegister('CONTROL_CON2_CHARGING_ALLOW', 1);
		
		writeRegister('RESERV_CON1_CMD', 0);
		writeRegister('RESERV_CON2_CMD', 0);
		
	} else {
		setTimeout(function(){
			mosbus_init(delay);
		}, delay);
	}
}

var print_idle = (function(){
	var a = 0;
	var progress_letters = ["/", "—", "\\", "|"];
	return function(text){
		a++;
		process.stdout.write('  ' + text + ' ' + progress_letters[a%progress_letters.length] + '\033[0G');
	}
})()

main_loop = function(delay){
	print_idle('IDLE: modbus_client_online_status: ' + modbus_client_online_status + ', mongo_client_online_status: ' + mongo_client_online_status);
	
	//writeMultiplyRegisters([getBufferFromUInt32(555)], 71);
	
	
	var read_modbus_function_name = (false) ? 'readHoldingRegisters' : 'readInputRegisters'; //(!!debug) ? 'readHoldingRegisters' : 'readInputRegisters';

	
	if(modbus_client_online_status == true && mongo_client_online_status == true) modbus_client[read_modbus_function_name](REGISTER_READ_OFFSET + 0, 100).then(function (first_resp) {
		modbus_client[read_modbus_function_name](REGISTER_READ_OFFSET + 100, 35).then(function (resp) {
			
			resp.byteCount += first_resp.byteCount;
			resp.payload = Buffer.concat([first_resp.payload, resp.payload]);
			resp.register += first_resp.register;
			
			var current_time = new Date().getTime();
			// resp will look like { fc: 4, byteCount: 20, register: [ values 0 - 10 ], payload: <Buffer> }
			//console.log(resp);
			//console.log(getRegValue(resp.payload, 'START_CON2_IDTAG', REGISTER_READ_OFFSET));
		
		    //console.log('START_CON2_CMD: ' + getRegValue(resp.payload, 'START_CON2_CMD', REGISTER_READ_OFFSET));
			//return;
		
			var result_object = {};
			for(register_name in register_map_read){
				//console.log(register_name);
				result_object[register_name] = getRegValue(resp.payload, register_name, REGISTER_READ_OFFSET);
			}
		
		    var result_write = {};
	    
		    //console.log(result_object);
	    
	    
			var throw_callback = function(err, result) {
				if(!!err){
					mongo_client_online_status = false;
					return true;
				}
				return false
			}
		
			//TAG AUTH
			//if(!!result_object.AUTH_CON1_CMD || !!result_object.AUTH_CON2_CMD){
			var find_auth = function(connector_id){
				if(!!result_object['AUTH_CON' + connector_id + '_CMD']){
					console.log('AUTH_CON' + connector_id + '_CMD == true');
					//console.log(connector_id);
					mongo_db_instance.collection("tag_requests").find({
						CONNECTOR_ID: connector_id
					}).sort({ _id: -1 }).limit(1).toArray(function(err, old_state) {
						console.log(old_state);
						
						if (throw_callback(err))
							return;
						if(!!old_state)
							old_state = old_state[0];
					
						if(!!old_state && !!old_state.AUTH_COMPLETE && result_object['AUTH_CON' + connector_id  + '_IDTAG'] == old_state.AUTH_IDTAG && old_state.STATUS == 'ReceivedFromOCPP'){
							//need write answer to modbus
							console.log('//need write answer to modbus');
							
							mongo_db_instance.collection("tag_requests").updateMany(
								{
									STATUS: 'ReceivedFromOCPP'
								}, {
									$set: {
										STATUS: 'TransmittedToModbus'
									} 
								}, throw_callback
							);
						
							writeRegister('AUTH_CON' + connector_id  + '_COMPLETE', 1);
							writeRegister('AUTH_CON' + connector_id  + '_IDTAG_ACCEPTED', +old_state.AUTH_IDTAG_ACCEPTED);
						} else {
							if(!!old_state && (old_state.STATUS == "ReceivedFromModbus" || old_state.STATUS == "TransmittedToOCPP" || old_state.STATUS == "TransmittedToModbus" ) ){
								console.log('not need write to DB');
							} else {
								//need write request to DB again
								console.log('need write to DB again');
								var new_state = {
									AUTH_IDTAG: result_object['AUTH_CON' + connector_id  + '_IDTAG'],
									STATUS: 'ReceivedFromModbus',
									TIME: current_time,
									CONNECTOR_ID: connector_id
								}
							
								if(old_state != null && !!old_state._id){
									mongo_db_instance.collection("tag_requests").updateOne({_id: old_state._id}, new_state, throw_callback);
								} else {
									mongo_db_instance.collection("tag_requests").insertOne(new_state, throw_callback);
								}
							}
						}
					});
				} else {
					
					mongo_db_instance.collection("tag_requests").updateMany(
						{
							STATUS: 'TransmittedToModbus',
							CONNECTOR_ID: connector_id
						}, {
							$set: {
								STATUS: 'AcceptedToModbus'
							} 
						}, throw_callback
					);
					
					writeRegister('AUTH_CON' + connector_id + '_COMPLETE', 0);
					writeRegister('AUTH_CON' + connector_id + '_IDTAG_ACCEPTED', 0);
				}
			};
			
			find_auth(1);
			find_auth(2);
		
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
			
				var boot_result_write = [getBufferFromUInt64(), getBufferFromUInt16(!!old_state ? old_state.BN_EVCHST_ACCEPTED : 0)];
						
				writeRegister('BN_CS_DATETIME', !!old_state ? old_state.BN_CS_DATETIME : 0);
				writeRegister('BN_EVCHST_ACCEPTED', !!old_state ? old_state.BN_EVCHST_ACCEPTED : 0);
			
				if(old_state != null && !!old_state._id){
					mongo_db_instance.collection("boot_notification_state").updateOne({_id: old_state._id}, { $set: new_state }, throw_callback);
				} else {
					mongo_db_instance.collection("boot_notification_state").insertOne(new_state, throw_callback);
				}
			
			});
		
			//HEARTBEAT
			mongo_db_instance.collection("heartbeat_state").findOne({}, function(err, old_state) {
				if (throw_callback(err))
					return;
		
				writeRegister('HB_CS_DATETIME', !!old_state ? old_state.HB_CS_DATETIME : 0);
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
		
			var find_start = function(connector_id){
				mongo_db_instance.collection("start_transaction").findOne({
					CONNECTOR_ID: connector_id
				}, function(err, old_state) {
					if (throw_callback(err))
						return;
					if(result_object['START_CON' + connector_id + '_CMD'] == true){
						console.log('START_CON' + connector_id + '_CMD == true');
						
						if(connector_id == 2){
							console.log('old_state')
							console.log(old_state)
							console.log('START_CON' + connector_id  + '_IDTAG: ' + result_object['START_CON' + connector_id  + '_IDTAG'])
							if(!!old_state){
								console.log("result_object['START_CON' + connector_id  + '_IDTAG'] == old_state.START_IDTAG -> " + (result_object['START_CON' + connector_id  + '_IDTAG'] == old_state.START_IDTAG))
								console.log("old_state.STATUS == 'ReceivedFromOCPP' -> " + (old_state.STATUS == 'ReceivedFromOCPP'))
								console.log("old_state.TIME+REREAD_TIMEOUT >= current_time -> " + (old_state.TIME+REREAD_TIMEOUT >= current_time))
							}
						}
						
						
						if(!!old_state && !!old_state.START_COMPLETE && result_object['START_CON' + connector_id  + '_IDTAG'] == old_state.START_IDTAG && old_state.STATUS == 'ReceivedFromOCPP' && old_state.TIME+REREAD_TIMEOUT >= current_time){
							//need write answer to modbus
							console.log('need write answer to modbus');
							console.log('START_CON' + connector_id  + '_COMPLETE: ' + 1);
							console.log('START_CON' + connector_id  + '_ACCEPTED: ' + +old_state.START_ACCEPTED);
							console.log('START_CON' + connector_id  + '_TRANSACTION_ID: ' + old_state.START_TRANSACTION_ID);
							
							writeRegister('START_CON' + connector_id  + '_COMPLETE', 1);
							writeRegister('START_CON' + connector_id  + '_ACCEPTED', +old_state.START_ACCEPTED);
							writeRegister('START_CON' + connector_id  + '_TRANSACTION_ID', old_state.START_TRANSACTION_ID);
						} else {
							if(!!old_state && old_state.STATUS == "ReceivedFromModbus"){
								console.log('not need write to DB');
							} else {
								//need write request to DB again
								console.log('need write to DB again');
								var new_state = {
									START_CONNECTOR_ID: result_object['START_CON' + connector_id  + '_CONNECTOR_ID'],
									START_WHMETER: result_object['START_CON' + connector_id  + '_WHMETER'],
									START_IDTAG: result_object['START_CON' + connector_id  + '_IDTAG'],
									STATUS: 'ReceivedFromModbus',
									TIME: current_time,
									CONNECTOR_ID: connector_id
								}
								
								if(connector_id == 2){
									console.log('new_state');
									console.log(new_state);
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
					
						//console.log('START_CON' + connector_id + '_CMD == false');
						writeRegister('START_CON' + connector_id  + '_COMPLETE', 0);
						writeRegister('START_CON' + connector_id  + '_ACCEPTED', 0);
						writeRegister('START_CON' + connector_id  + '_TRANSACTION_ID', 0);
					}
				});
			}
		
			find_start(1);
			find_start(2);
		
			//STATUS NOTIFICATION
			var status_notif = function(connector_id){
		    	if(result_object['SN_CON' + connector_id + '_CMD'] == true){
					mongo_db_instance.collection("status_notifications").findOne({
						CONNECTOR_ID: connector_id,
						STATUS: 'ReceivedFromModbus',
						SN_CON_FAULTCODE: getConnectorFaultcode(result_object['SN_CON' + connector_id + '_FAULTCODE']),
						SN_CON_STATUS: getConnectorStatus(result_object['SN_CON' + connector_id + '_STATUS'])
					}, function(err, old_state) {
						if(!!old_state){
							console.log('status_notifications not need write');
							writeRegister('SN_CON' + connector_id + '_COMPLETE', 1);
						} else {
							mongo_db_instance.collection("status_notifications").insertOne({
								CONNECTOR_ID: connector_id,
								SN_CON_FAULTCODE: getConnectorFaultcode(result_object['SN_CON' + connector_id + '_FAULTCODE']),
								SN_CON_STATUS: getConnectorStatus(result_object['SN_CON' + connector_id + '_STATUS']),
								STATUS: 'ReceivedFromModbus'
							}, function(err, insert_result){
								if (throw_callback(err))
									return;
								writeRegister('SN_CON' + connector_id + '_COMPLETE', 1);
							});
						}
					});
				} else {
					writeRegister('SN_CON' + connector_id + '_COMPLETE', 0);
				}
			}
			
		    status_notif(1);
			status_notif(2);
		
		    //STOP TRANSACTION
			var find_stop = function(connector_id){
				if(result_object['STOP_CON' + connector_id + '_CMD'] == true){
					console.log('STOP_CON' + connector_id + '_CMD == true');
					mongo_db_instance.collection("stop_transactions").findOne({
						STOP_TRANSACTION_ID: ''+result_object['STOP_CON' + connector_id + '_TRANSACTION_ID'],
						STOP_CONNECTOR_ID: connector_id
					}, function(err, old_state) {
						if (throw_callback(err))
							return;
						
						console.log(old_state)
						if(old_state != null && !!old_state._id){
							//FINDED STOP_TRANSACTION_ID
							if(old_state.STATUS == 'ReceivedFromOCPP'){
								writeRegister('STOP_CON' + connector_id  + '_COMPLETE', 1);
							} else {
								//wait response
							}
						} else {
							var new_state = {
								STOP_CONNECTOR_ID: connector_id,
								STOP_WHMETER: result_object['STOP_CON' + connector_id + '_WHMETER'],
								STOP_IDTAG: result_object['STOP_CON' + connector_id + '_IDTAG'],
								STOP_TRANSACTION_ID: ''+result_object['STOP_CON' + connector_id + '_TRANSACTION_ID'],
								STATUS: 'ReceivedFromModbus',
								TIME: current_time
							}
							mongo_db_instance.collection("stop_transactions").insertOne(new_state, throw_callback);
						}
					});
				} else {
					//console.log('STOP_CON' + connector_id + '_CMD == false');
					writeRegister('STOP_CON' + connector_id  + '_COMPLETE', 0);
				}
			}
		
			find_stop(1);
			find_stop(2);
		
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
				
					mongo_db_instance.collection("reserve_state").updateOne({_id: values._id}, { $set: {STATUS: 'TransmittedToModbus'} }, function(err, res){
						if (throw_callback(err))
							return;
					
						writeRegister('RESERV_CON' + values.CONNECTOR_ID  + '_IDTAG', values.RESERV_CON_IDTAG+'');
						writeRegister('RESERV_CON' + values.CONNECTOR_ID  + '_RESID', values.RESERV_CON_RESID);
						writeRegister('RESERV_CON' + values.CONNECTOR_ID  + '_DATETIME', +values.RESERV_CON_DATETIME);
						writeRegister('RESERV_CON' + values.CONNECTOR_ID  + '_CMD', values.RESERV_CON_CMD);			
					});
				
				}
			});
		
			mongo_db_instance.collection("reserve_state").find(
				{
					STATUS: 'TransmittedToModbus',
					RESERV_CON_CMD: 1,
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
					if(+values.RESERV_CON_DATETIME < +current_time ){
				
						mongo_db_instance.collection("reserve_state").updateOne({_id: values._id}, { $set: {STATUS: 'ExpiredToModbus', RESERV_CON_CMD: 0} }, function(err, res){
							if (throw_callback(err))
								return;
							
							writeRegister('RESERV_CON' + values.CONNECTOR_ID  + '_CMD', 0);		
						});
					}
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
						
						writeRegister('CONTROL_CON' + values.CONNECTOR_ID  + '_LOCK_ALLOW', values.CAN_CHARGE);
						writeRegister('CONTROL_CON' + values.CONNECTOR_ID  + '_CHARGING_ALLOW', values.CAN_CHARGE);
						writeRegister('CONTROL_CON' + values.CONNECTOR_ID  + '_AUTH_ALLOW', values.CAN_AUTH);			
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
						
						writeRegister('CONTROL_CON' + values.CONNECTOR_ID  + '_LOCK_ALLOW', values.CAN_LOCK);
						setTimeout(function(CONNECTOR_ID){
							writeRegister('CONTROL_CON' + CONNECTOR_ID  + '_LOCK_ALLOW', 1);
						}, UNLOCK_TIMEOUT, values.CONNECTOR_ID);
					});
				
				}
			});
		
			mongo_db_instance.collection("stop_requests").findOne({
				STATUS: 'ReceivedFromOCPP'
			}, function(err, old_state) {
				if (throw_callback(err))
					return;
				if (!!old_state) {
					if(!!old_state.TRANSACTION_ID && !!old_state.CONNECTOR_ID){
						
						mongo_db_instance.collection("stop_requests").updateOne({_id: old_state._id}, { $set: {STATUS: 'TransmittedToModbus'} }, function(err, res){
							if (throw_callback(err))
								return;
							
							writeRegister('RMT_STOP_CON' + old_state.CONNECTOR_ID  + '_CMD', 1);
							writeRegister('RMT_STOP_CON' + old_state.CONNECTOR_ID  + '_TRANSACTION_ID', old_state.TRANSACTION_ID);
						}); 
					} else {
						mongo_db_instance.collection("stop_requests").updateOne({_id: old_state._id}, { $set: {STATUS: 'FieldsError'} }, throw_callback);
					}
				}
			});
			
			mongo_db_instance.collection("stop_requests").findOne({
				STATUS: 'TransmittedToModbus'
			}, function(err, old_state) {
				if (throw_callback(err))
					return;
				if (!!old_state) {
					if(!!old_state.TRANSACTION_ID && old_state.CONNECTOR_ID){
						if(result_object['RMT_STOP_CON' + old_state.CONNECTOR_ID  + '_COMPLETE'] == 1){
							mongo_db_instance.collection("stop_requests").updateOne({_id: old_state._id}, { 
								$set: {STATUS: 'ReceivedFromModbus', 'ACCEPTED': result_object['RMT_STOP_CON' + old_state.CONNECTOR_ID  + '_ACCEPTED']} 
							}, function(err, res){
								if (throw_callback(err))
									return;
								writeRegister('RMT_STOP_CON' + old_state.CONNECTOR_ID  + '_CMD', 0);
							}); 
						}
					} else {
						mongo_db_instance.collection("stop_requests").updateOne({_id: old_state._id}, { $set: {STATUS: 'FieldsError'} }, throw_callback);
					}
				}
			});
		
			mongo_db_instance.collection("start_requests").findOne({
				STATUS: 'ReceivedFromOCPP'
			}, function(err, old_state) {
				if (throw_callback(err))
					return;
				
				if (!!old_state) {
					if(!!old_state.TAG_ID && !!old_state.CONNECTOR_ID){
						mongo_db_instance.collection("start_requests").updateOne({_id: old_state._id}, { $set: {STATUS: 'TransmittedToModbus'} }, function(err, res){
							if (throw_callback(err))
								return;
							
							writeRegister('RMT_START_CON' + old_state.CONNECTOR_ID  + '_CMD', 1);
							writeRegister('RMT_START_CON' + old_state.CONNECTOR_ID  + '_IDTAG', old_state.TAG_ID);
						}); 
					} else {
						mongo_db_instance.collection("start_requests").updateOne({_id: old_state._id}, { $set: {STATUS: 'FieldsError'} }, throw_callback);
					}
				}
			});
			
			mongo_db_instance.collection("start_requests").findOne({
				STATUS: 'TransmittedToModbus'
			}, function(err, old_state) {
				if (throw_callback(err))
					return;
				if (!!old_state) {
					if(!!old_state.TAG_ID && old_state.CONNECTOR_ID){
						if(result_object['RMT_START_CON' + old_state.CONNECTOR_ID  + '_COMPLETE'] == 1){
							mongo_db_instance.collection("start_requests").updateOne({_id: old_state._id}, { 
								$set: {STATUS: 'ReceivedFromModbus', 'ACCEPTED': result_object['RMT_START_CON' + old_state.CONNECTOR_ID  + '_ACCEPTED']} 
							}, function(err, res){
								if (throw_callback(err))
									return;
								writeRegister('RMT_START_CON' + old_state.CONNECTOR_ID  + '_CMD', 0);
							}); 
						}
					} else {
						mongo_db_instance.collection("start_requests").updateOne({_id: old_state._id}, { $set: {STATUS: 'FieldsError'} }, throw_callback);
					}
				}
			});
	
	    }, console.error);
	
    }, console.error);
	
	setTimeout(function(){
		main_loop(delay);
	}, delay);
}

if(!debug){
	client.bind(UDP_LISTENING_PORT);
} else {
	//modbus_up('192.168.2.92', 502);
	//modbus_up('127.0.0.1', 502);
	modbus_up(debug_addr, 502);
}