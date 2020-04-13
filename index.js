const mqtt = require('mqtt');
const request = require('request-promise');
const _ = require('underscore');
const express = require('express');
const bodyParser = require('body-parser');
const varClientId = makeId(30);

const sessionUrl = 'https://web-api-prod-obo.horizon.tv/oesp/v3/BE/nld/web/session';
const jwtUrl = 'https://web-api-prod-obo.horizon.tv/oesp/v3/BE/nld/web/tokens/jwt';
const channelsUrl = 'https://web-api-prod-obo.horizon.tv/oesp/v3/BE/nld/web/channels';
const mqttUrl = 'wss://obomsg.prod.be.horizon.tv:443/mqtt';

let mqttClient = {};

let telenetUsername;
let telenetPassword;
let console;

let Service;
let Characteristic;

let mqttUsername;
let mqttPassword;
let setopboxId;
let setopboxState;
let stations = [];
let uiStatus;
let currentChannel;
let currentChannelId;
let currentState;

const sessionRequestOptions = {
    method: 'POST',
    uri: sessionUrl,
    body: {
		username: telenetUsername,
		password: telenetPassword
    },
    json: true
};

function makeId(length) {
	let result  = '';
	let characters  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let charactersLength = characters.length;
	for ( let i = 0; i < length; i++ ) {
		result += characters.charAt(Math.floor(Math.random() * charactersLength));
	}
	return result;
};






// --== MAIN SETUP ==--
function TelenetPlatform(log, config) {
	console = log;
  this.log = log;
  this.config = config;
}

/* Initialise Accessory */
function TelenetAccessory(log, config) {
  this.log = log;

  this.config = config;
  this.sysConfig = null;
  this.name = config.name || 'Telenet TV-box';

  this.inputs = [];
  this.enabledServices = [];
  this.inputServices = [];
  this.playing = true;

  // Configuration
  telenetUsername = this.config.username || '';
  telenetPassword = this.config.username || '';

//  this.getChannels();
  this.getSession();
  this.setInputs();

  // Check & Update Accessory Status every 5 seconds
  this.checkStateInterval = setInterval(
    this.updateTelenetState.bind(this),
    5000,
  );
}

module.exports = (homebridge) => {
  ({ Service, Characteristic } = homebridge.hap);
  homebridge.registerPlatform('homebridge-telenet-tv-box', 'telenet-tv-box', TelenetPlatform);
};

TelenetPlatform.prototype = {
  accessories(callback) {
    callback([
      new TelenetAccessory(
        this.log,
        this.config
      ),
    ]);
  },
};

TelenetAccessory.prototype = {
  /* Services */
  getServices() {
    this.informationService();
    this.televisionService();
    this.televisionSpeakerService();
    this.inputSourceServices();
//	this.volumeService();

    return this.enabledServices;
  },

  informationService() {
    // Create Information Service
    this.informationService = new Service.AccessoryInformation();
    this.informationService
      .setCharacteristic(Characteristic.Name, this.name)
      .setCharacteristic(Characteristic.Manufacturer, 'Telenet')
      // .setCharacteristic(Characteristic.FirmwareRevision, require('./package.json').version)
      .setCharacteristic(Characteristic.Model, 'TV-box')
      .setCharacteristic(Characteristic.SerialNumber, 'Unknown');

    this.enabledServices.push(this.informationService);
  },

  televisionService() {
    // Create Television Service (AVR)
    this.tvService = new Service.Television(this.name, 'telenetService');

    this.tvService
      .setCharacteristic(Characteristic.ConfiguredName, this.name)
      .setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

    this.tvService
      .getCharacteristic(Characteristic.Active)
      .on('get', this.getPowerState.bind(this))
      .on('set', this.setPowerState.bind(this));

    this.tvService
      .getCharacteristic(Characteristic.ActiveIdentifier)
      .on('get', this.getInputState.bind(this))
      .on('set', (inputIdentifier, callback) => {
        this.setInputState(this.inputs[inputIdentifier], callback);
      });

    this.tvService
      .getCharacteristic(Characteristic.RemoteKey)
      .on('set', this.remoteKeyPress.bind(this));

    this.enabledServices.push(this.tvService);
  },

  televisionSpeakerService() {
      this.tvSpeakerService = new Service.TelevisionSpeaker(`${this.name} AVR`, 'telenetSpeakerService');
      this.tvSpeakerService
        .setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)
        .setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.ABSOLUTE);

      this.tvSpeakerService
        .getCharacteristic(Characteristic.VolumeSelector)
        .on('set', (direction, callback) => {
          callback();
        });

      this.tvService.addLinkedService(this.tvSpeakerService);
      this.enabledServices.push(this.tvSpeakerService);
  },


  inputSourceServices() {
    for (let i = 0; i < 50; i++) {
      const inputService = new Service.InputSource(i, `inputSource_${i}`);

      inputService
        .setCharacteristic(Characteristic.Identifier, i)
        .setCharacteristic(Characteristic.ConfiguredName, `Input ${i < 9 ? `0${i + 1}` : i + 1}`)
        .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.NOT_CONFIGURED)
        .setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.APPLICATION)
        .setCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.HIDDEN);

      inputService
        .getCharacteristic(Characteristic.ConfiguredName)
        .on('set', (value, callback) => {
          callback(null, value);
        });

      this.tvService.addLinkedService(inputService);
      this.inputServices.push(inputService);
      this.enabledServices.push(inputService);
    }
  },



	getSession() {
		sessionRequestOptions.body.username = this.config.username;
		sessionRequestOptions.body.password = this.config.password;

		request(sessionRequestOptions)
			.then((json) => {
 				//this.log(json);
				sessionJson = json;
				
				this.getJwtToken(sessionJson.oespToken, sessionJson.customer.householdId);
			})
			.catch((err) => {
				this.log('getSession: ', err.message);
			});
			
		//return sessionJson || false;
	},


	getJwtToken(oespToken, householdId)  {
		const jwtRequestOptions = {
			method: 'GET',
			uri: jwtUrl,
			headers: {
				'X-OESP-Token': oespToken,
				'X-OESP-Username': telenetUsername
			},
			json: true
		};
		
		request(jwtRequestOptions)
			.then(json => {
				jwtJson = json;

				this.log(jwtJson);

				mqttUsername = householdId;
				mqttPassword = jwtJson.token;

				this.startMqttClient(this);
			})
			.catch(function (err) {
//				this.log('getJwtToken: ', err.message);
				return false;
			});
	},

	startMqttClient(parent) {
		mqttClient = mqtt.connect(mqttUrl, {
			connectTimeout: 10*1000, //10 seconds
			clientId: varClientId,
			username: mqttUsername,
			password: mqttPassword
		});
		
		mqttClient.on('connect', function () {
			mqttClient.subscribe(mqttUsername, function (err) {
				if(err){
					parent.log(err);
					return false;
				}
			});
			
			mqttClient.subscribe(mqttUsername +'/+/status', function (err) {
				if(err){
					parent.log(err);
					return false;
				}
			});

			mqttClient.on('message', function (topic, payload) {

				let payloadValue = JSON.parse(payload);

				if(payloadValue.deviceType){
					if(payloadValue.deviceType == 'STB'){
						setopboxId = payloadValue.source;
						setopboxState = payloadValue.state;

						if (setopboxState == 'ONLINE_RUNNING')
							currentState = true;
						else if (setopboxState == 'OFFLINE')
							currentState = false;

						mqttClient.subscribe(mqttUsername + '/' + varClientId, function (err) {
							if(err){
								parent.log(err);
								return false;
							}
						});
						
						mqttClient.subscribe(mqttUsername + '/' + setopboxId, function (err) {
							if(err){
								parent.log(err);
								return false;
							}
						});
						
						mqttClient.subscribe(mqttUsername + '/'+ setopboxId +'/status', function (err) {
							if(err){
								parent.log(err);
								return false;
							}
						});

						parent.getUiStatus();
					}
				}
				
				if(payloadValue && payloadValue.status){
					parent.log(payloadValue.status);

					if(payloadValue.status.playerState) {
						currentChannelId = payloadValue.status.playerState.source.channelId;

						parent.log('Current channel:', currentChannelId);
					}
				}
			});
			
			mqttClient.on('error', function(err) {
				parent.log(err);

				mqttClient.end();
				return false;
			});

			mqttClient.on('close', function () {
				parent.log('Connection closed');
				mqttClient.end();
				return false;
			});
		});
	},


	switchChannel(channel) {
		this.log('Switch to', channel);
		mqttClient.publish(mqttUsername + '/' + setopboxId, '{"id":"' + makeId(8) + '","type":"CPE.pushToTV","source":{"clientId":"' + varClientId + '","friendlyDeviceName":"HomeKit"},"status":{"sourceType":"linear","source":{"channelId":"' + channel + '"},"relativePosition":0,"speed":1}}')
	},

	powerKey() {
		this.log('Power on/off');
		mqttClient.publish(mqttUsername + '/' + setopboxId, '{"id":"' + makeId(8) + '","type":"CPE.KeyEvent","source":"' + varClientId + '","status":{"w3cKey":"Power","eventType":"keyDownUp"}}');
		currentState = (currentState ? false : true);

		this.tvService.getCharacteristic(Characteristic.Active).updateValue(currentState);
	},

	escapeKey() {
		this.log('Send escape-key');
		mqttClient.publish(mqttUsername + '/' + setopboxId, '{"id":"' + makeId(8) + '","type":"CPE.KeyEvent","source":"' + varClientId + '","status":{"w3cKey":"Escape","eventType":"keyDownUp"}}')
	},

	pauseKey() {
		this.log('Send pause-key');
		mqttClient.publish(mqttUsername + '/' + setopboxId, '{"id":"' + makeId(8) + '","type":"CPE.KeyEvent","source":"' + varClientId + '","status":{"w3cKey":"MediaPause","eventType":"keyDownUp"}}')
	},

	sendKey(key) {
		this.log('Send key');
		mqttClient.publish(mqttUsername + '/' + setopboxId, '{"id":"' + makeId(8) + '","type":"CPE.KeyEvent","source":"' + varClientId + '","status":{"w3cKey":"'+key+'","eventType":"keyDownUp"}}')
	},

	getUiStatus() {
		this.log('Get UI status');
		this.log(mqttClient);
		mqttClient.publish(mqttUsername + '/' + setopboxId, '{"id":"' + makeId(8) + '","type":"CPE.getUiStatus","source":"' + varClientId + '"}')
	},


  /* State Handlers */
  updateTelenetState(error, status) {
	this.log('updateTelenetState');

	this.setInputs();

    if (this.tvService) {
	  this.tvService.getCharacteristic(Characteristic.Active).updateValue(currentState);


	  if (status && currentChannelId) {
          this.inputs.filter((input, index) => {
            if (input.id === currentChannelId) {
              // Get and update homekit accessory with the current set input
              if (this.tvService.getCharacteristic(Characteristic.ActiveIdentifier).value !== index) {
                this.log(`Updating input from ${input.name} to ${input.name}`);
                return this.tvService.getCharacteristic(Characteristic.ActiveIdentifier).updateValue(index);
              }
            }

            return null;
          });
      }
    }
  },

  setInputs() {
	  this.log('setInputs');

	if (this.inputServices && this.inputServices.length) {
		request({ url: channelsUrl, json: true}).then(availableInputs => {
          const sanitizedInputs = [];

          let i = 0;
		  availableInputs.channels.forEach(function (channel) {
			  if (i < 50)
			  {
				  sanitizedInputs.push({id: channel.stationSchedules[0].station.serviceId, name: channel.title, index: i});
			  }
			  i++;
		  });

          this.inputs = sanitizedInputs;

          this.inputs.forEach((input, i) => {
            const inputService = this.inputServices[i];
            inputService.getCharacteristic(Characteristic.ConfiguredName).updateValue( `${i < 9 ? `0${i + 1}` : i + 1}` + ". " + input.name);
            inputService.getCharacteristic(Characteristic.IsConfigured).updateValue(Characteristic.IsConfigured.CONFIGURED);
            inputService.getCharacteristic(Characteristic.CurrentVisibilityState).updateValue(Characteristic.CurrentVisibilityState.SHOWN);
          });
        },
        error => {
          this.log(`Failed to get available inputs from ${this.config.name}. Please verify the AVR is connected and accessible at ${this.config.ip}`);
        }
      );
    }
  },

  getPowerState(callback) {
	  this.log('getPowerState');

	  callback(null, (currentState || false));
  },

  setPowerState(state, callback) {
	this.log('Power on/off');
	mqttClient.publish(mqttUsername + '/' + setopboxId, '{"id":"' + makeId(8) + '","type":"CPE.KeyEvent","source":"' + varClientId + '","status":{"w3cKey":"Power","eventType":"keyDownUp"}}');
	currentState = (currentState ? false : true);

    callback();
  },


  getInputState(callback) {
	  this.log('getInputState');

	  isDone = false;

	  this.inputs.filter((input, index) => {
        if (input.id === currentChannelId) {
          this.log(`Current Input: ${input.name}`, index);
		  isDone = true;
          return callback(null, index);
        }
      });

	  if (!isDone)
		  return callback(null, null);
  },

  setInputState(input, callback) {
	  this.log('setInputState');

	this.log(`Set input: ${input.name} (${input.id})`);
    this.switchChannel(input.id);
    callback();
  },

  sendRemoteCode(remoteKey, callback) {
	  this.log('sendRemoteCode');

	callback(true);
  },

  remoteKeyPress(remoteKey, callback) {
    switch (remoteKey) {
      case Characteristic.RemoteKey.REWIND:
        this.sendKey('MediaRewind');
        callback();
        break;
      case Characteristic.RemoteKey.FAST_FORWARD:
        this.sendKey('MediaFastForward');
        callback();
        break;
      case Characteristic.RemoteKey.NEXT_TRACK:
        this.sendKey('DisplaySwap');
        callback();
        break;
      case Characteristic.RemoteKey.PREVIOUS_TRACK:
        this.sendKey('DisplaySwap');
        callback();
        break;
      case Characteristic.RemoteKey.ARROW_UP:
        this.sendKey('ArrowUp');
        callback();
        break;
      case Characteristic.RemoteKey.ARROW_DOWN:
        this.sendKey('ArrowDown');
        callback();
        break;
      case Characteristic.RemoteKey.ARROW_LEFT:
        this.sendKey('ArrowLeft');
        callback();
        break;
      case Characteristic.RemoteKey.ARROW_RIGHT:
        this.sendKey('ArrowRight');
        callback();
        break;
      case Characteristic.RemoteKey.SELECT:
        this.sendKey('Enter');
        callback();
        break;
      case Characteristic.RemoteKey.BACK:
        this.sendKey('Exit');
        callback();
        break;
      case Characteristic.RemoteKey.EXIT:
        this.sendKey('Exit');
        callback();
        break;
      case Characteristic.RemoteKey.PLAY_PAUSE:
        this.sendKey('MediaPlay');
        callback();
        break;
      case Characteristic.RemoteKey.INFORMATION:
        this.sendKey('Info');
        callback();
        break;
      default:
        callback();
        break;
    }
  },
};
