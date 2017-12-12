var start_message = 
`<ns:pdu xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ns="http://www.momentum.com/ADDP/PDU">
	<hw_agent type="other.EVChargeControl" id="0" project_id_and_version="0000000000000000" project_swcompile_datetime="0000000000000000">
        <protocols>
            <modbus_tcp>
                <transports>
                    <tcp>
                        <port>502</port>
                    </tcp>
                </transports>
                <slave_id>1</slave_id>
            </modbus_tcp>
        </protocols>
    </hw_agent>
</ns:pdu>`;

var dgram = require('dgram'); 
var server = dgram.createSocket("udp4"); 
	server.bind( function() {
	server.setBroadcast(true)
	server.setMulticastTTL(128);
	broadcastNew()
});

function broadcastNew() {
	var message = new Buffer(start_message);
	server.send(message, 0, message.length, 7751, "224.1.1.1");
	setTimeout(function(){ process.exit(); }, 200);
	//console.log("Sent " + message + " to the wire...");
}