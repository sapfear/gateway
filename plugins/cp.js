const MongoClient    = require('mongodb').MongoClient;
var cbxs = {

  name: 'CBXS',
  description: 'CBXS automatic mode description',
  author: '',

  ocpp_version: '1.5',
  system: 'cp',
  
  onLoad: function() {
	console.log("Plugin Loaded");
    var self = cbxs.self = this;
    var main_loop, boot_notificate_loop;

	self.mongo_url = 'mongodb://localhost:27017/test_2';
	self.boot_state = 1; //not booted
	self.mongo_client_online_status = false;
	
    if(self.system != 'cp') {
      self.log(cbxs.logPrefix + 'Error: this plugin needs a Charge Point '+
        'Simulator to run.');
      self.unload();
      return;
    }
	cbxs.connected = false;

    self.onConnectionEvent(function(type, cbId) {
		switch(type) {
			case 'connected':
				cbxs.setConnected(true);
				self.log(cbxs.logPrefix + 'Connected to Central System.');
				cbxs.processTransactionsQueue();
			break;
			case 'disconnected':
				cbxs.setConnected(false);
				self.log(cbxs.logPrefix + 'Disconnected to Central System.');
			break;
		}
    });
	
	var findedInLocalList = function(TAG_ID){
		var result = false;
		for(i = 0; i < cbxs.whiteList.length; i++){
			if(cbxs.whiteList[i].idTag == TAG_ID && (new Date(cbxs.whiteList[i].idTagInfo.expiryDate) > new Date()) )
				result = true;
		}
		return result;
	}
	
	self.throw_callback = function(err, result) {
		if(!!err){
			//mongo_db_instance.close();
			//mongoConnect(1000);
			self.mongo_client_online_status = false;
			return true;
		}
		return false
		//if (err) throw err;
	}
	
	main_loop = function(delay){
		setTimeout(function(){
			console.log('IDLE');
			if(self.mongo_client_online_status == false){
				main_loop(delay);
				return;
			}
			
			self.mongo_db_instance.collection("tag_requests").findOne({STATUS: 'ReceivedFromModbus'}, function(err, result) {
				if (self.throw_callback(err))
					return;
				if(!!result && !!result.AUTH_IDTAG){
					if(findedInLocalList(result.AUTH_IDTAG)){
						console.log('finded in localAuthorisationList');
						self.mongo_db_instance.collection("tag_requests").updateOne(
							{
								STATUS: 'ReceivedFromModbus'
							}, {
								$set: {
									STATUS: 'ReceivedFromOCPP', 
									TIME: new Date().getTime(),
									AUTH_COMPLETE: 1,
									AUTH_IDTAG_ACCEPTED: 1
								} 
							}, self.throw_callback
						);
					} else {
						if(new Date().getTime() - cbxs.auth_request_time > 10*1000){
							self.mongo_db_instance.collection("tag_requests").updateOne({_id: result._id}, { $set: {STATUS: 'TransmittedToOCPP'} }, function(err, res){
								if (self.throw_callback(err))
									return;
									
								cbxs.idTagTmp = result.AUTH_IDTAG;
								cbxs.auth_request_time = new Date().getTime();
								
								cbxs.actionsQueue.push({
									procedure: 'Authorize',
									arguments: { idTag: result.AUTH_IDTAG }
								});
								cbxs.processActionsQueue();
							});
						}
					}
				}
			});
			
			self.mongo_db_instance.collection("status_notifications").findOne({STATUS: 'ReceivedFromModbus'}, function(err, result) {
				if (self.throw_callback(err))
					return;
				if(!!result && !!result.SN_CON_FAULTCODE && !!result.SN_CON_STATUS && !!result.CONNECTOR_ID){
					self.mongo_db_instance.collection("status_notifications").updateOne({_id: result._id}, { $set: {STATUS: 'TransmittedToOCPP'} }, function(err, res){
						if (self.throw_callback(err))
							return;
						cbxs.actionsQueue.push({
							procedure: 'StatusNotification',
							arguments: {
					        	connectorId: result.CONNECTOR_ID,
					        	status: result.SN_CON_STATUS,
					        	errorCode: result.SN_CON_FAULTCODE
					      	}
						});
					});
					cbxs.processActionsQueue();
				} else {
					if(!!result && !!result._id){
						self.mongo_db_instance.collection("status_notifications").updateOne({_id: result._id}, { $set: {STATUS: 'FieldsError'} }, self.throw_callback);
						console.log('FieldsError')
					} 
				}
			});
			
			self.mongo_db_instance.collection("start_transaction").findOne({STATUS: 'ReceivedFromModbus'}, function(err, result) {
				if (self.throw_callback(err))
					return;
						
				if(!!result && !!result.START_IDTAG){
					self.mongo_db_instance.collection("start_transaction").updateOne({_id: result._id}, { $set: {STATUS: 'TransmittedToOCPP'} }, function(err, res){
						if (self.throw_callback(err))
							return;
						
						cbxs.actionsQueue.push({
							procedure: 'StartTransaction',
							arguments: { 
								connectorId: result.START_CONNECTOR_ID,
						        idTag: result.START_IDTAG,
						        timestamp: result.current_time,
						        meterStart: result.START_WHMETER,
						        reservationId: 0
							}
						});
						cbxs.startRequestConnectorId = result.START_CONNECTOR_ID;
						cbxs.processActionsQueue();
					});
				}
			});
			
			self.mongo_db_instance.collection("stop_transactions").findOne({STATUS: 'ReceivedFromModbus'}, function(err, result) {
				if (self.throw_callback(err))
					return;
						
				if(!!result && !!result.STOP_IDTAG){
					self.mongo_db_instance.collection("stop_transactions").updateOne({_id: result._id}, { $set: {STATUS: 'TransmittedToOCPP'} }, function(err, res){
						if (self.throw_callback(err))
							return;
						cbxs.actionsQueue.push({
							procedure: 'StopTransaction',
							arguments: { 
						        transactionId: result.STOP_TRANSACTION_ID,
						        idTag: result.STOP_IDTAG,
						        timestamp: result.TIME,
						        meterStop: result.STOP_WHMETER,
						        transactionData: null
							}
						});
						cbxs.processActionsQueue();
					});
				}
			});
			main_loop(delay);
		}, delay);
	}
	
	boot_notificate_loop = function(delay){
		setTimeout(function(){
			if(self.mongo_client_online_status == true){
				switch(self.boot_state){
					case 1:
						//not booted
						console.log('self.boot_state: not booted');
						self.mongo_db_instance.collection("boot_notification_state").findOne({}, function(err, result) {
							
							if (err) boot_notificate_loop(delay);
							
							if (!!result && result.BN_PLC_RUNNING == 1){
								console.log('result.BN_PLC_RUNNING == 1');
								cbxs.actionsQueue.push({
									procedure: 'BootNotification',
									arguments: {
								        chargePointVendor: 'MOMENTUM_VENDOR',
								        chargePointModel: result.BN_EVCHST_MODEL,
								        chargePointSerialNumber: 'POINT_' + result.BN_PLC_SW_VERSION,
								        chargeBoxSerialNumber: 'BOX_' + result.BN_PLC_SW_VERSION,
								        firmwareVersion: result.BN_PLC_SW_VERSION,
								        iccid: '',
								        imsi: '',
								        meterType: 'DBT NQC-ACDC',
								        meterSerialNumber: '1.000e48'
							      	}
								});
								cbxs.processActionsQueue();
								
								self.mongo_db_instance.collection("local_list").findOne({}, function(err, result) {
									cbxs.whiteList = (!!result && !!result.TAG_LIST) ? result.TAG_LIST : [];
									cbxs.whiteListVersion = (!!result && !!result.LIST_VERSION) ? result.LIST_VERSION : -1;
								});
							    self.boot_state = 2;
								boot_notificate_loop(delay);
							} else {
								boot_notificate_loop(200);
							}
						});
					break;
					case 2:
						//wait boot response from ocpp
						console.log('self.boot_state: wait boot response from ocpp');
						boot_notificate_loop(200);
					break;
					case 3:
						//boot notification successfull
						console.log('self.boot_state: boot notification successfull');
						main_loop(1000);
					break;
				}
			} else {
				boot_notificate_loop(delay);
			}
		}, delay);
	}
	
	var mongoConnect = function(delay){
		setTimeout(function(){
			console.log("MongoClient start connect");
			MongoClient.connect(self.mongo_url, {
			        reconnectTries: 60, // retry to connect for 60 times
			        reconnectInterval: 1000 // wait 1 second before retrying
			    }, function(err, db) {
				self.mongo_client_online_status = (err == null);
				self.mongo_db_instance = db;
				console.log('mongo_connection established: ' + self.mongo_client_online_status);
				if(!self.mongo_client_online_status){
					mongoConnect(delay);
				} else {
	    			self.mongo_db_instance.s.topology.on('close', () => self.mongo_client_online_status = false );
	    			self.mongo_db_instance.s.topology.on('reconnect', () => self.mongo_client_online_status = true );
					boot_notificate_loop(3000);
				}
			});
			
		}, delay)
	}
	mongoConnect(1000);

    /**
     *  Custom commands
     */
    self.onCommand(function(command) {
    });

    /**
     *  what to do when receiving a call result:
     */
    self.onResult('BootNotification', function(values) {
		if(self.mongo_client_online_status != false) self.mongo_db_instance.collection("boot_notification_state").findOne({}, function(err, old_state) {
			if (self.throw_callback(err))
				return;
			
			var new_state = {
				$set: {
		    		BN_CS_DATETIME: new Date(values.currentTime).getTime(),
		    		BN_EVCHST_ACCEPTED: +(values.status == 'Accepted')
				}
			}
			
			if(old_state != null && !!old_state._id){
				self.mongo_db_instance.collection("boot_notification_state").updateOne({_id: old_state._id}, new_state, function(err, res){
					if (self.throw_callback(err))
						return;
					self.boot_state = 3;
				});
			}
		});
		
		cbxs.heartbeatInterval = values.heartbeatInterval;
		//console.log('heartbeatInterval: ' + cbxs.heartbeatInterval);
		cbxs.sendHB(self, false);
    });

    self.onResult('Authorize', function(values) {
		console.log(values.idTagInfo.status);
		
		console.log(cbxs.idTagTmp);
		
		if(self.mongo_client_online_status != false) self.mongo_db_instance.collection("tag_requests").updateOne(
			{
				STATUS: 'TransmittedToOCPP'
			}, {
				$set: {
					STATUS: 'ReceivedFromOCPP', 
					TIME: new Date().getTime(),
					AUTH_COMPLETE: 1,
					AUTH_IDTAG_ACCEPTED: (!!values && !!values.idTagInfo && !!values.idTagInfo.status && values.idTagInfo.status.toUpperCase() == 'ACCEPTED')
				} 
			}, self.throw_callback
		);
    });
	
    self.onResult('Heartbeat', function(values) {
		//console.log(values);
		if(self.mongo_client_online_status != false) self.mongo_db_instance.collection("heartbeat_state").findAndModify(
			{ 
				query: 'not_finded'
			}, [['_id','asc']],	{
				$setOnInsert: { HB_CS_DATETIME: new Date(values.currentTime).getTime() }
			}, {
				new: true,   // return new doc if one is upserted
				upsert: true // insert the document if it does not exist
			}, self.throw_callback
		);
    });
	
    self.onResult('StartTransaction', function(values) {
		if(self.mongo_client_online_status != false) self.mongo_db_instance.collection("start_transaction").updateOne(
			{
				STATUS: 'TransmittedToOCPP',
				CONNECTOR_ID: cbxs.startRequestConnectorId
			}, {
				$set: {
					STATUS: 'ReceivedFromOCPP', 
					TIME: new Date().getTime(),
					START_COMPLETE: 1,
					START_ACCEPTED: (!!values && !!values.idTagInfo && !!values.idTagInfo.status && values.idTagInfo.status.toUpperCase() == 'ACCEPTED'),
					START_TRANSACTION_ID: values.transactionId
				} 
			}, self.throw_callback
		);
    });

    self.onResult('StopTransaction', function(values) {
    	console.log('StopTransaction')
    	console.log(values)
		if(self.mongo_client_online_status != false) self.mongo_db_instance.collection("stop_transaction").updateMany(
			{
				STATUS: 'TransmittedToOCPP'
			}, {
				$set: {
					STATUS: 'ReceivedFromOCPP'
				} 
			}, self.throw_callback
		);
    });

    /**
     *  when a remote call is received:
     */

    self.onCall('SendLocalList', function(values) {
		var result = {};
		if(values.updateType.toUpperCase() == 'FULL' && self.mongo_client_online_status != false){
			self.mongo_db_instance.collection("local_list").update(
				{
					STATUS: 'ReceivedFromOCPP'
				}, {
					$set: {
						'STATUS': 'ReceivedFromOCPP',
						'LIST_VERSION': values.listVersion,
						'TAG_LIST': values.localAuthorisationList
					} 
				}, {
					upsert: true
				}, function(err, update_result) {
					if (self.throw_callback(err))
						return;
					cbxs.whiteList = values.localAuthorisationList;
					cbxs.whiteListVersion = values.listVersion;
					//console.log(update_result);
				}
			);
			return { status: "Accepted" };
		} else {
			return { status: "Rejected" };
		}
    });

    self.onCall('ClearCache', function(values) {
		// clear the white list
		if(self.mongo_client_online_status != false){
			self.mongo_db_instance.collection("local_list").drop(function(err){	
				if (self.throw_callback(err))
					return;
				cbxs.whiteList = [];
				cbxs.whiteListVersion = -1;
			});
			return { status: "Accepted" };
		} else {
			return { status: "Rejected" };
		}
    });
	
    self.onCall('GetLocalListVersion', function(values) {
		return { listVersion: cbxs.whiteListVersion };
    });
	
    self.onCall('GetConfiguration', function(values) {
		// clear the white list
		
		var configuration_list = {
			VENDOR_ID: {
				value: 'MOMENTUM_VENDOR',
				readonly: true
			},
			KVCBX_PROFILE: {
				value: '12.56/17',
				readonly: true
			}
		};
		
		var conf_keys = [], unknownKeys = [];
		for(i = 0; i < values.key.length; i++){
			console.log(values.key);
			console.log(configuration_list[values.key[i]]);
			if(!!configuration_list[values.key[i]]){
				conf_keys.push({
					"key": values.key[i],
					"readonly": configuration_list[values.key[i]].readonly,
					"value": configuration_list[values.key[i]].value
				});
			} else {
				unknownKeys.push(configuration_list[i]);
			}
		}
		
		return { configurationKey: conf_keys, unknownKeys: unknownKeys};
    });

    self.onCall('RemoteStopTransaction', function(values) {
    	//RemoteStopTransactionRequest: {
        //	transactionId: 1
      	//},
      	console.log(values);
      	var transactionId = values.transactionId+'';
      	
      	console.log(transactionId);
		if(self.mongo_client_online_status != false){
			self.mongo_db_instance.collection("stop_requests").update(
				{
					TRANSACTION_ID: transactionId
				}, {
					$set: {
						'STATUS': 'ReceivedFromOCPP',
						'TRANSACTION_ID': transactionId,
					} 
				}, {
					upsert: true
				}, self.throw_callback
			);
			return { status: "Accepted" };
		} else {
			return { status: "Rejected" };
		}
    });

    self.onCall('RemoteStartTransaction', function(values) {
    	//RemoteStartTransactionRequest: {
	    //	idTag: '044943121F1D80',
	    //	connectorId: 2
		//},
		
      	var idTag = values.idTag+'';
      	var connectorId = values.connectorId;
      	
		if(self.mongo_client_online_status != false){
			self.mongo_db_instance.collection("start_requests").update(
				{
					CONNECTOR_ID: connectorId
				}, {
					$set: {
						'STATUS': 'ReceivedFromOCPP',
						'CONNECTOR_ID': connectorId,
						'TAG_ID': idTag
					} 
				}, {
					upsert: true
				}, self.throw_callback
			);
			return { status: "Accepted" };
		} else {
			return { status: "Rejected" };
		}
    });

    self.onCall('ReserveNow', function(values) {
		//remote_reservenow
		console.log(values);
		var connectorId = values.connectorId+'';
	  
		if(self.mongo_client_online_status != false){
			self.mongo_db_instance.collection("reserve_state").update(
				{
					CONNECTOR_ID: connectorId
				}, {
					$set: {
						'STATUS': 'ReceivedFromOCPP',
						'RESERV_CON_IDTAG': values.idTag,
						'RESERV_CON_RESID': values.reservationId+'',
						'RESERV_CON_DATETIME': new Date(values.expiryDate).getTime(),
						'RESERV_CON_CMD': 1,
						'CONNECTOR_ID': connectorId
					} 
				}, {
					upsert: true
				}, self.throw_callback
			);
			return { status: "Accepted" };
		} else {
			return { status: "Rejected" };
		}
    });
	
	self.onCall('CancelReservation', function(values) {
		if(self.mongo_client_online_status != false){
			self.mongo_db_instance.collection("reserve_state").update(
				{
					RESERV_CON_RESID: values.reservationId+''
				}, {
					$set: {
						RESERV_CON_CMD: 0
					}
				}, {
					upsert: true
				}, self.throw_callback
			);
			return { status: "Accepted" };
		} else {
			return { status: "Rejected" };
		}
	});

    self.onCall('ChangeAvailability', function(values) {
		console.log(values);
		var connectorId = values.connectorId + '';
		var can_charge = (!!values && !!values.type && values.type.toUpperCase() == 'OPERATIVE')
	  
		if(self.mongo_client_online_status != false){
			self.mongo_db_instance.collection("availability_state").update(
				{
					CONNECTOR_ID: connectorId
				}, {
					$set: {
						STATUS: 'ReceivedFromOCPP',
						CAN_CHARGE: can_charge,
						CAN_AUTH: can_charge,
						CONNECTOR_ID: connectorId
					} 
				}, {
					upsert: true
				}, self.throw_callback
			);	
			return { status: "Accepted" };
		} else {
			return { status: "Rejected" };
		}
    });
	
    self.onCall('UnlockConnector', function(values) {
		console.log(values);
		var connectorId = values.connectorId + '';
	  
		if(self.mongo_client_online_status != false){
			self.mongo_db_instance.collection("lock_state").update(
				{
					CONNECTOR_ID: connectorId
				}, {
					$set: {
						STATUS: 'ReceivedFromOCPP',
						CAN_LOCK: 0,
						CONNECTOR_ID: connectorId
					} 
				}, {
					upsert: true
				}, self.throw_callback
			);	
			return { status: "Accepted" };
		} else {
			return { status: "Rejected" };
		}
    });

    self.onCall('GetDiagnostics', function(values) {
      self.cp.call('DiagnosticsStatusNotification', {"status": "Uploaded"});
    });

    self.onCall('UpdateFirmware', function(values) {
      self.cp.call('FirmwareStatusNotification', {"status": "Downloaded"});
      self.cp.call('FirmwareStatusNotification', {"status": "Installed"});
    });

    self.onIdle(function() {
      cbxs.processActionsQueue();

      //clearTimeout(cbxs.hbTimeout);
      //cbxs.sendHB(self, true);
    });
  },

  /**
   *  Customs fields
   */

  self: null,

  logPrefix: '[CBXS] ',

  whiteList: [],
  whiteListVersion: -1,
  actionsQueue: [],
  transactionsQueue: [],

  hbTimeout: null,
  heartbeatInterval: null,

  idTagTmp: null,
  auth_request_time: 0,
  startRequestConnectorId: null,

  transactionIdClient: 0,
  
  connected: false,

  connectors: [
    {
      connectorId: 1,
      isCharging: false,
      isBlocked: false,
      isLiaisonWorking: true,
      idTagRelated: "",

      transactionIdClient: null, // generated by client
      transactionIdServer: null, // response from server
    },{
      connectorId: 2,
      isCharging: false,
      isBlocked: false,
      isLiaisonWorking: true,
      idTagRelated: "",

      transactionIdClient: null, // generated by client
      transactionIdServer: null, // response from server
    }
  ],

  processActionsQueue: function() {
    var msg = null;
    
    while(msg = cbxs.actionsQueue.pop()) {
      switch(msg.procedure) {
      case false && 'StartTransaction':
        var connector
            = cbxs.getConnectorFromConnectorId(msg.arguments.connectorId);
          if(!connector.isBlocked && connector.isLiaisonWorking) {
            cbxs.transactionsQueue.push(msg);
            cbxs.processTransactionsQueue();
          }
        break;
      default:
        cbxs.transactionsQueue.push(msg);
        cbxs.processTransactionsQueue();
      }
    }
  },
  
  setConnected: function(state){
  	cbxs.connected = state;
  },

  processTransactionsQueue: function() {
    var msg = null;
    if(!!cbxs.connected){
	    while(msg = cbxs.transactionsQueue.pop()) {
	      cbxs.self.cp.call(msg.procedure, msg.arguments);
	    }
    }
  },

  sendHB: function(self, dropFirst) {
	//console.log('dropFirst '+ dropFirst);
	//console.log('heartbeatInterval ' + cbxs.heartbeatInterval);
    if(!cbxs.heartbeatInterval)
      return;

    if(!dropFirst)
      self.cp.call('Heartbeat');

    cbxs.hbTimeout = setTimeout(cbxs.sendHB, cbxs.heartbeatInterval * 1000,
      self);
  },

  startTransactionIfPossible: function(connectorId) {
    var connector = null;
    for(var index in cbxs.connectors) {
      var c = cbxs.connectors[index];
      if(c.connectorId == connectorId)
        connector = c;
    }

    if(connector == null)
      return;

    if(!connector.isBlocked && connector.isLiaisonWorking) {
      cbxs.actionsQueue.push({
        procedure: 'StartTransaction',
        arguments: {
          connectorId: connectorId,
          idTag: connector.idTagRelated,
          timestamp: new Date().toISOString(),
          meterStart: 0,
          reservationId: 0
        }
      });
    }
    else {
      cbxs.self.log(cbxs.logPrefix + "Can't start transaction on connector #"+
        connectorId);
    }
  },

  getAvailableConnector: function() {
    for(var index in cbxs.connectors) {
      var connector = cbxs.connectors[index];
      if(!connector.isCharging)
        return connector;
    }

    return null;
  },

  getConnectorFromConnectorId: function(connectorId) {
    for(var index in cbxs.connectors) {
      var c = cbxs.connectors[index];
      if(c.connectorId == connectorId)
        return c;
    }

    return null;
  }

};

module.exports = cbxs;

