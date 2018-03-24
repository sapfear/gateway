const MongoClient    = require('mongodb').MongoClient;

var url = "mongodb://localhost:27017/test_2";
var req_count = 14;

MongoClient.connect(url, function(err, db) {
	var rf_1 = { tagID: '__1209' + new Date().getTime(), status: 'Requested' };
	var callback = function(err, res) {
		if (err) throw err;
		console.log("1 document inserted");
		console.log(res);
		//db.close();
	};
	var check_close = function(){
		req_count--;
		if(req_count == 0)
			db.close();
	}
	//db.collection("rfid_reqs").insertOne(rf_1, callback);
	db.collection("tag_requests").find({}).toArray(function(err, old_state) {
		console.log("=======================");
		console.log("tag_requests");
		console.log(old_state);
		check_close();
	});
	if(1) db.collection("boot_notification_state").findOne({}, function(err, old_state) {
		console.log("=======================");
		console.log("boot_notification_state");
		console.log(old_state);
		check_close();
	});
	if(1) db.collection("meter_values").findOne({}, function(err, old_state) {
		console.log("=======================");
		console.log("meter_values");
		console.log(old_state);
		check_close();
	});
	if(1) db.collection("start_transaction").findOne({}, function(err, old_state) {
		console.log("=======================");
		console.log("start_transaction");
		console.log(old_state);
		check_close();
	});
	if(1) db.collection("status_notifications").find({}).sort({ _id: -1 }).limit(10).toArray(function(err, old_state) {
		console.log("=======================");
		console.log("status_notifications");
		console.log(old_state);
		check_close();
	});
	if(1) db.collection("stop_transactions").find({}).sort({ _id: -1 }).limit(3).toArray( function(err, old_state) {
		console.log("=======================");
		console.log("stop_transactions");
		console.log(old_state);
		check_close();
	});
	if(1) db.collection("reserve_state").find({}).limit(5).toArray( function(err, old_state) {
		console.log("=======================");
		console.log("reserve_state");
		console.log(old_state);
		check_close();
	});
	if(1) db.collection("availability_state").find({}).limit(5).toArray( function(err, old_state) {
		console.log("=======================");
		console.log("availability_state");
		console.log(old_state);
		check_close();
	});
	if(1) db.collection("lock_state").find({}).limit(5).toArray( function(err, old_state) {
		console.log("=======================");
		console.log("lock_state");
		console.log(old_state);
		check_close();
	});
	if(1) db.collection("heartbeat_state").findOne({}, function(err, old_state) {
		console.log("=======================");
		console.log("heartbeat_state");
		console.log(old_state);
		check_close();
	});
	if(1) db.collection("local_list").findOne({}, function(err, old_state) {
		console.log("=======================");
		console.log("local_list");
		console.log(old_state);
		check_close();
	});
	if(1) db.collection("stop_requests").find({}).limit(5).toArray( function(err, old_state) {
		console.log("=======================");
		console.log("stop_requests");
		console.log(old_state);
		check_close();
	});
	if(1) db.collection("start_requests").find({}).limit(5).toArray( function(err, old_state) {
		console.log("=======================");
		console.log("start_requests");
		console.log(old_state);
		check_close();
	});
	if(1) db.collection("configuration_info").find({}).limit(1).toArray( function(err, old_state) {
		console.log("=======================");
		console.log("configuration_info");
		console.log(old_state);
		check_close();
	});
});