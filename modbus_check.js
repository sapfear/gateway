const REGISTER_READ_OFFSET = 0;
const REGISTER_WRITE_OFFSET = 0;

var modbus = require('jsmodbus');
var modbus_client_online_status = false;

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

main_loop = function(delay){
	//writeMultiplyRegisters([getBufferFromUInt16(123)], 72);
	
	var read_modbus_function_name = (0) ? 'readHoldingRegisters' : 'readInputRegisters'; 
	
	console.log('IDLE: modbus_client_online_status: ' + modbus_client_online_status);
	
	if(modbus_client_online_status == true) modbus_client[read_modbus_function_name](REGISTER_READ_OFFSET + 0, 1).then(function (resp) {
		console.log(resp);
		console.log(resp.payload);
		
		console.log(getRegistrValueUInt16(resp.payload, 0));
		//console.log(getRegistrValueStr(resp.payload, 0, 20));
	}, console.error);
	
	setTimeout(function(){
		main_loop(delay);
	}, delay);
};

modbus_up('192.168.7.2', 502);