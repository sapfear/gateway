const REGISTER_READ_OFFSET = 200;
const REGISTER_WRITE_OFFSET = 0;

var modbus = require('jsmodbus');
var modbus_client, modbus_client_online_status = false;

var register_map_read = {}, register_map_write = {};

const isLittleEndian = true;

var read_configs = function(){
	var lines = require('fs').readFileSync(__dirname + '/config/regs_2.csv', 'utf-8')
		.split('\n')
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
	//console.log(register_map);	
	
	//mongoConnect(1000);
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

var writeRegister = function(name, value){
	var reg_obj = register_map_write[name];
	if(!reg_obj)
		return null;
	
	var buf;
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
	
	modbus_client.writeSingleRegister(reg_obj.startAddress + REGISTER_WRITE_OFFSET, buf).then(function (resp) {

    }, console.error);
}

var writeMultiplyRegisters = function(data, registr_start){
	modbus_client.writeMultipleRegisters(REGISTER_WRITE_OFFSET + registr_start, Buffer.concat(data)).then(function (resp) {
        
        // resp will look like { fc : 16, startAddress: 4, quantity: 4 }
        //console.log(resp);
        
    }, console.error);
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

main_loop = function(delay){
	//writeMultiplyRegisters([getBufferFromUInt16(123)], 72);
	
	var read_modbus_function_name = (0) ? 'readHoldingRegisters' : 'readInputRegisters'; 
	
	console.log('IDLE: modbus_client_online_status: ' + modbus_client_online_status);
	
	if(modbus_client_online_status == true) modbus_client[read_modbus_function_name](REGISTER_READ_OFFSET + 0, 100).then(function (first_resp) {
		modbus_client[read_modbus_function_name](REGISTER_READ_OFFSET + 100, 36).then(function (resp) {
			
			resp.byteCount += first_resp.byteCount;
			resp.payload = Buffer.concat([first_resp.payload, resp.payload]);
			resp.register += first_resp.register;
			var result_object = {};
			for(register_name in register_map_read){
				result_object[register_name] = getRegValue(resp.payload, register_name, REGISTER_READ_OFFSET);
			}

			console.log(result_object);
			//console.log(result_object['START_CON2_CMD']);
			//console.log(getRegValue(resp.payload, 'START_CON2_CMD', REGISTER_READ_OFFSET));
			
			
			
			
		}, console.error);
	}, console.error);
	
	setTimeout(function(){
		main_loop(delay);
	}, delay);
};

modbus_up('192.168.7.2', 502);
//modbus_up('127.0.0.1', 502);
//modbus_up('192.168.2.92', 502);