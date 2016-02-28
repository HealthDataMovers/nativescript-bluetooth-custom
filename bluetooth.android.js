var utils = require("utils/utils");
var Bluetooth = require("./bluetooth-common");

var adapter,
    onDiscovered;

// connections are stored as key-val pairs of UUID-Connection
/**
 * So something like this:
 * [{
 *   34343-2434-5454: {
 *     state: 'connected',
 *     discoveredState: '',
 *     operationConnect: someCallbackFunction
 *   },
 *   1323213-21321323: {
 *     ..
 *   }
 * }, ..]
 */
// TODO rename to peripherals, also see iOS' peripheralArray
Bluetooth._connections = {};

(function () {
  var bluetoothManager = utils.ad.getApplicationContext().getSystemService(android.content.Context.BLUETOOTH_SERVICE);
  adapter = bluetoothManager.getAdapter();
  
  if (android.os.Build.VERSION.SDK_INT >= 21 /*android.os.Build.VERSION_CODES.LOLLIPOP */) {
    var MyScanCallback = android.bluetooth.le.ScanCallback.extend({
      onBatchScanResults: function(results) {
        console.log("------- scanCallback.onBatchScanResults");
      },
      onScanFailed: function(errorCode) {
        console.log("------- scanCallback.onScanFailed errorCode: " + errorCode);
        var errorMessage;
        if (errorCode == android.bluetooth.le.ScanCallback.SCAN_FAILED_ALREADY_STARTED) {
          errorMessage = "Scan already started";
        } else if (errorCode == android.bluetooth.le.ScanCallback.SCAN_FAILED_APPLICATION_REGISTRATION_FAILED) {
          errorMessage = "Application registration failed";
        } else if (errorCode == android.bluetooth.le.ScanCallback.SCAN_FAILED_FEATURE_UNSUPPORTED) {
          errorMessage = "Feature unsupported";
        } else if (errorCode == android.bluetooth.le.ScanCallback.SCAN_FAILED_INTERNAL_ERROR) {
          errorMessage = "Internal error";
        } else {
          errorMessage = "Scan failed to start";          
        }
        console.log("------- scanCallback.onScanFailed errorMessage: " + errorMessage);
      },
      onScanResult: function(callbackType, result) {
        if (!Bluetooth._findPeripheral(result.getDevice().getAddress())) {
          var payload = {
            type: 'scanResult', // TODO or use different callback functions?
            RSSI: result.getRssi(),
            device: {
              name: result.getDevice().getName(),
              address: result.getDevice().getAddress()
            },
            advertisement: android.util.Base64.encodeToString(result.getScanRecord().getBytes(), android.util.Base64.NO_WRAP)
          };
          console.log("---- Lollipop+ scanCallback result: " + JSON.stringify(payload));
          onDiscovered(payload);
        }
      }
    });
    Bluetooth._scanCallback = new MyScanCallback();
  } else {
    Bluetooth._scanCallback = new android.bluetooth.BluetoothAdapter.LeScanCallback({
      // see https://github.com/randdusing/cordova-plugin-bluetoothle/blob/master/src/android/BluetoothLePlugin.java#L2181
      onLeScan: function(device, rssi, scanRecord) {
        var stateObject = Bluetooth._connections[device.getAddress()];
        if (!stateObject) {
          Bluetooth._connections[device.getAddress()] = {
            state: 'disconnected'
          };
          onDiscovered({
            type: 'scanResult', // TODO or use different callback functions?
            UUID: device.getAddress(), // TODO consider renaming to id (and iOS as well)
            name: device.getName(),
            RSSI: rssi,
            state: 'disconnected'
          });
        }
      }
    });
  }
})();

// callback for connecting and read/write operations
Bluetooth._MyGattCallback = android.bluetooth.BluetoothGattCallback.extend({
  // add constructor which gets a callback
  
  /**
   * newState (BluetoothProfile.state)
   * 0: disconnected
   * 1: connecting
   * 2: connected
   * 3: disconnecting
   */
  onConnectionStateChange: function(bluetoothGatt, status, newState) {
    console.log("------- _MyGattCallback.onConnectionStateChange, status: " + status);
    console.log("------- _MyGattCallback.onConnectionStateChange, newState: " + newState);

    // https://github.com/don/cordova-plugin-ble-central/blob/master/src/android/Peripheral.java#L191    
    if (newState == 2 /* connected */ && status === 0 /* gatt success */) {
      console.log("---- discovering services..");
      bluetoothGatt.discoverServices();
    } else {
      Bluetooth._disconnect(bluetoothGatt);
    }
  },
  
  onServicesDiscovered: function(bluetoothGatt, status) {
    console.log("------- _MyGattCallback.onServicesDiscovered, status (0=success): " + status);

    if (status === 0 /* gatt success */) {
      // TODO grab from cached object and extend with services data?
      var services = bluetoothGatt.getServices();
      var servicesJs = [];
      var btChar = android.bluetooth.BluetoothGattCharacteristic;
      for (var i = 0; i < services.size(); i++) {
        var service = services.get(i);
        var characteristics = service.getCharacteristics();
        var characteristicsJs = [];
        for (var j = 0; j < characteristics.size(); j++) {
          var characteristic = characteristics.get(j);
          var props = characteristic.getProperties();
          var descriptors = characteristic.getDescriptors();
          var descriptorsJs = [];
          for (var k = 0; k < descriptors.size(); k++) {
            var descriptor = descriptors.get(k);
            var descriptorJs = {
              UUID: Bluetooth._uuidToString(descriptor.getUuid()),
              value: descriptor.getValue() // always empty btw
            };
            var descPerms = descriptor.getPermissions();
            if (descPerms > 0) {
              descriptorJs.permissions = {
                read: (descPerms & btChar.PERMISSION_READ) !== 0,
                readEncrypted: (descPerms & btChar.PERMISSION_READ_ENCRYPTED) !== 0,
                readEncryptedMitm: (descPerms & btChar.PERMISSION_READ_ENCRYPTED_MITM) !== 0,
                write: (descPerms & btChar.PERMISSION_WRITE) !== 0,
                writeEncrypted: (descPerms & btChar.PERMISSION_WRITE_ENCRYPTED) !== 0,
                writeEncryptedMitm: (descPerms & btChar.PERMISSION_WRITE_ENCRYPTED_MITM) !== 0,
                writeSigned: (descPerms & btChar.PERMISSION_WRITE_SIGNED) !== 0,
                writeSignedMitm: (descPerms & btChar.PERMISSION_WRITE_SIGNED_MITM) !== 0
              };
            }
            descriptorsJs.push(descriptorJs);
          }
          
          var characteristicJs = {
            UUID: Bluetooth._uuidToString(characteristic.getUuid()),
            name: Bluetooth._uuidToString(characteristic.getUuid()), // there's no sep field on Android
            properties: {
              read: (props & btChar.PROPERTY_READ) !== 0,
              write: (props & btChar.PROPERTY_WRITE) !== 0,
              writeWithoutResponse: (props & btChar.PROPERTY_WRITE_NO_RESPONSE) !== 0,
              notify: (props & btChar.PROPERTY_NOTIFY) !== 0,
              indicate: (props & btChar.PROPERTY_INDICATE) !== 0,
              broadcast: (props & btChar.PROPERTY_BROADCAST) !== 0,
              authenticatedSignedWrites: (props & btChar.PROPERTY_SIGNED_WRITE) !== 0,
              extendedProperties: (props & btChar.PROPERTY_EXTENDED_PROPS) !== 0
            },
            descriptors: descriptorsJs
          };
          // permissions are usually not provided, so let's not return them in that case
          var charPerms = characteristic.getPermissions();
          if (charPerms > 0) {
            characteristicJs.permissions = {
              read: (charPerms & btChar.PERMISSION_READ) !== 0,
              readEncrypted: (charPerms & btChar.PERMISSION_READ_ENCRYPTED) !== 0,
              readEncryptedMitm: (charPerms & btChar.PERMISSION_READ_ENCRYPTED_MITM) !== 0,
              write: (charPerms & btChar.PERMISSION_WRITE) !== 0,
              writeEncrypted: (charPerms & btChar.PERMISSION_WRITE_ENCRYPTED) !== 0,
              writeEncryptedMitm: (charPerms & btChar.PERMISSION_WRITE_ENCRYPTED_MITM) !== 0,
              writeSigned: (charPerms & btChar.PERMISSION_WRITE_SIGNED) !== 0,
              writeSignedMitm: (charPerms & btChar.PERMISSION_WRITE_SIGNED_MITM) !== 0
            };
          }
          characteristicsJs.push(characteristicJs);
        }

        servicesJs.push({
          UUID: Bluetooth._uuidToString(service.getUuid()),
          characteristics: characteristicsJs
        });
      }
      var device = bluetoothGatt.getDevice();
      var stateObject = Bluetooth._connections[device.getAddress()];
      stateObject.onConnected({
        UUID: device.getAddress(), // TODO consider renaming to id (and iOS as well)
        name: device.getName(),
        state: 'connected', // Bluetooth._getState(peripheral.state),
        services: servicesJs
      });
    }
  },
  
  onCharacteristicRead: function(bluetoothGatt, bluetoothGattCharacteristic, status) {
    console.log("------- _MyGattCallback.onCharacteristicRead");

    var device = bluetoothGatt.getDevice();
    var stateObject = Bluetooth._connections[device.getAddress()];
    if (!stateObject) {
      Bluetooth._disconnect(bluetoothGatt);
      return;
    }

    if (stateObject.onReadPromise) {
      var value = bluetoothGattCharacteristic.getValue();
      var data = new Uint8Array(value);
      stateObject.onReadPromise({
        value: value,
        valueDecoded: data[1],
        characteristicUUID: bluetoothGattCharacteristic.getUuid()
      });
    }
  },
  
  onCharacteristicChanged: function(bluetoothGatt, bluetoothGattCharacteristic) {
    console.log("------- _MyGattCallback.onCharacteristicChanged");

    var device = bluetoothGatt.getDevice();
    var stateObject = Bluetooth._connections[device.getAddress()];
    if (!stateObject) {
      Bluetooth._disconnect(bluetoothGatt);
      return;
    }
    
    if (stateObject.onNotifyCallback) {
      var value = bluetoothGattCharacteristic.getValue();
      var data = new Uint8Array(value);
      console.log("------- _MyGattCallback.onCharacteristicChanged, decodedvalue: " + data[1]);
      stateObject.onNotifyCallback({
        value: value,
        valueDecoded: data[1],
        characteristicUUID: bluetoothGattCharacteristic.getUuid()
      });
    }
  },
  
  onCharacteristicWrite: function(bluetoothGatt, bluetoothGattCharacteristic, status) {
    console.log("------- _MyGattCallback.onCharacteristicWrite");
    // TODO implement
  },
  
  onDescriptorRead: function(bluetoothGatt, bluetoothGattDescriptor, status) {
    console.log("------- _MyGattCallback.onDescriptorRead");
  },
  
  onDescriptorWrite: function(bluetoothGatt, bluetoothGattDescriptor, status) {
    console.log("------- _MyGattCallback.onDescriptorWrite");
  },

  onReadRemoteRssi: function(bluetoothGatt, rssi, status) {
    console.log("------- _MyGattCallback.onReadRemoteRssi");
  },

  onMtuChanged: function(bluetoothGatt, mtu, status) {
    console.log("------- _MyGattCallback.onMtuChanged");
  }
});

Bluetooth._isEnabled = function (arg) {
  return adapter !== null && adapter.isEnabled();
};

Bluetooth.isBluetoothEnabled = function (arg) {
  return new Promise(function (resolve, reject) {
    try {
      resolve(Bluetooth._isEnabled());
    } catch (ex) {
      console.log("Error in Bluetooth.isBluetoothEnabled: " + ex);
      reject(ex);
    }
  });
};

// Java UUID -> JS
Bluetooth._uuidToString = function(uuid) {
  var uuidStr = uuid.toString();
  var pattern = java.util.regex.Pattern.compile("0000(.{4})-0000-1000-8000-00805f9b34fb", 2);
  var matcher = pattern.matcher(uuidStr);
  return matcher.matches() ? matcher.group(1) : uuidStr;
};

// JS UUID -> Java
Bluetooth._stringToUuid = function(uuidStr) {
  if (uuidStr.length === 4) {
    uuidStr = "0000" + uuidStr + "-0000-1000-8000-00805f9b34fb";
  }
  return java.util.UUID.fromString(uuidStr);
};

Bluetooth.startScanning = function (arg) {
  return new Promise(function (resolve, reject) {
    try {
      // if (onDiscovered) {
        // TODO clear this callback when stopping scanning :)
        // reject("Already scanning");
        // return;
      // }

      Bluetooth._connections = {};

      var serviceUUIDs = arg.serviceUUIDs || [];
      var uuids = [];
      for (var s in serviceUUIDs) {
        uuids.push(Bluetooth._stringToUuid(serviceUUIDs[s]));
      }
      
      if (android.os.Build.VERSION.SDK_INT < 21 /*android.os.Build.VERSION_CODES.LOLLIPOP */) {
        var didStart = uuids.length === 0 ?
            adapter.startLeScan(Bluetooth._scanCallback) :
            adapter.startLeScan(uuids, Bluetooth._scanCallback);
        if (!didStart) {
          // TODO error msg, see https://github.com/randdusing/cordova-plugin-bluetoothle/blob/master/src/android/BluetoothLePlugin.java#L758
          reject("Scanning didn't start");
          return;
        }
      } else {
        var scanFilters = new java.util.ArrayList();
        for (var u in uuids) {
          var theUuid = uuids[u];
          var scanFilterBuilder = new android.bluetooth.le.ScanFilter.Builder();
          scanFilterBuilder.setServiceUuid(new android.os.ParcelUuid(theUuid));
          scanFilters.add(scanFilterBuilder.build());
        }
        // ga hier verder: https://github.com/randdusing/cordova-plugin-bluetoothle/blob/master/src/android/BluetoothLePlugin.java#L775
        var scanSettings = new android.bluetooth.le.ScanSettings.Builder();
        scanSettings.setReportDelay(0);

        var scanMode = arg.scanMode || android.bluetooth.le.ScanSettings.SCAN_MODE_LOW_LATENCY;
        scanSettings.setScanMode(scanMode);
        
        if (android.os.Build.VERSION.SDK_INT >= 23 /*android.os.Build.VERSION_CODES.M */) {
          var matchMode = arg.keyMatchMode || android.bluetooth.le.ScanSettings.MATCH_MODE_AGGRESSIVE;
          scanSettings.setMatchMode(matchMode);

          var matchNum = argkeyMatchNum || android.bluetooth.le.ScanSettings.MATCH_NUM_MAX_ADVERTISEMENT;
          scanSettings.setNumOfMatches(matchNum);
          
          var callbackType = arg.keyCallbackType || android.bluetooth.le.ScanSettings.CALLBACK_TYPE_ALL_MATCHES;
          scanSettings.setCallbackType(callbackType);
        }
        adapter.getBluetoothLeScanner().startScan(scanFilters, scanSettings.build(), Bluetooth._scanCallback);
      }

      onDiscovered = arg.onDiscovered;

      if (arg.seconds) {
        setTimeout(function() {
          // note that by now a manual 'stop' may have been invoked, but that doesn't hurt
          if (android.os.Build.VERSION.SDK_INT < 21 /* android.os.Build.VERSION_CODES.LOLLIPOP */) {
            adapter.stopLeScan(Bluetooth._scanCallback);
          } else {
            adapter.getBluetoothLeScanner().stopScan(Bluetooth._scanCallback);
          }
          resolve();
        }, arg.seconds * 1000);
      } else {
        resolve();
      }
    } catch (ex) {
      console.log("Error in Bluetooth.startScanning: " + ex);
      reject(ex);
    }
  });
};

// TODO check iOS - I seem to be missing stop/start scanning stuff in iOS... check the BigMac!
Bluetooth.stopScanning = function () {
  return new Promise(function (resolve, reject) {
    try {
      if (android.os.Build.VERSION.SDK_INT < 21 /* android.os.Build.VERSION_CODES.LOLLIPOP */) {
        adapter.stopLeScan(Bluetooth._scanCallback);
      } else {
        adapter.getBluetoothLeScanner().stopScan(Bluetooth._scanCallback);
      }
      resolve();
    } catch (ex) {
      console.log("Error in Bluetooth.stopScanning: " + ex);
      reject(ex);
    }
  });
};

Bluetooth._disconnect = function(gatt) {
  if (gatt !== null) {
    var device = gatt.getDevice();
    var stateObject = Bluetooth._connections[device.getAddress()];
    console.log("----- invoking disc cb");
    if (stateObject && stateObject.onDisconnected) {
      stateObject.onDisconnected({
        UUID: device.getAddress(),
        name: device.getName()
      });
    } else {
      console.log("----- !!! no disconnect callback found");      
    }
    Bluetooth._connections[device.getAddress()] = null;
    gatt.close();
  }
};

// note that this doesn't make much sense without scanning first
Bluetooth.connect = function (arg) {
  return new Promise(function (resolve, reject) {
    try {
      // or macaddress..
      if (!arg.UUID) {
        reject("No UUID was passed");
        return;
      }
      var bluetoothDevice = adapter.getRemoteDevice(arg.UUID);
      if (bluetoothDevice === null) {
        reject("Could not find device with UUID " + arg.UUID);
      } else {
        console.log("Connecting to device with UUID: " + arg.UUID);
        var bluetoothGatt = bluetoothDevice.connectGatt(
          utils.ad.getApplicationContext(), // context
          false, // autoconnect
          new Bluetooth._MyGattCallback(/* TODO pass in onWhatever function */)
        );
        // TODO (fill, and use this object in disconnect() as well)
        Bluetooth._connections[arg.UUID] = {
          state: 'connecting',
          onConnected: arg.onConnected,
          onDisconnected: arg.onDisconnected,
          device: bluetoothGatt // TODO rename device to gatt?
        };
      }
      // resolve();
    } catch (ex) {
      console.log("Error in Bluetooth.connect: " + ex);
      reject(ex);
    }
  });
};

Bluetooth.disconnect = function (arg) {
  return new Promise(function (resolve, reject) {
    try {
      if (!arg.UUID) {
        reject("No UUID was passed");
        return;
      }
      var connection = Bluetooth._connections[arg.UUID];
      if (!connection) {
        reject("Device wasn't connected");
        return;
      }
      
      Bluetooth._disconnect(connection.device);
      resolve();
    } catch (ex) {
      console.log("Error in Bluetooth.disconnect: " + ex);
      reject(ex);
    }
  });
};

Bluetooth._findPeripheral = function(UUID) {
  for (var i = 0; i < Bluetooth._state.peripheralArray.count; i++) {
    var peripheral = Bluetooth._state.peripheralArray.objectAtIndex(i);
    if (UUID == peripheral.identifier.UUIDString) {
      return peripheral;
    }
  }
  return null;
};

// This guards against devices reusing char UUID's. We prefer notify.
Bluetooth._findNotifyCharacteristic = function(bluetoothGattService, characteristicUUID) {
  // Check for Notify first
  var characteristics = bluetoothGattService.getCharacteristics();
  for (var i = 0; i < characteristics.size(); i++) {
    var c = characteristics.get(i);
    if ((c.getProperties() & android.bluetooth.BluetoothGattCharacteristic.PROPERTY_NOTIFY) !== 0 && characteristicUUID.equals(c.getUuid())) {
        return c;
    }
  }
  
  // If there wasn't a Notify Characteristic, check for Indicate
  for (i = 0; i < characteristics.size(); i++) {
    var ch = characteristics.get(i);
    if ((ch.getProperties() & android.bluetooth.BluetoothGattCharacteristic.PROPERTY_INDICATE) !== 0 && characteristicUUID.equals(ch.getUuid())) {
        return ch;
    }
  }
  
  // As a last resort, try and find ANY characteristic with this UUID, even if it doesn't have the correct properties
  return bluetoothGattService.getCharacteristic(characteristicUUID);
};      

// This guards against devices reusing char UUID's.
Bluetooth._findReadableCharacteristic = function(bluetoothGattService, characteristicUUID) {

  var characteristics = bluetoothGattService.getCharacteristics();
  for (var i = 0; i < characteristics.size(); i++) {
    var c = characteristics.get(i);
    if ((c.getProperties() & android.bluetooth.BluetoothGattCharacteristic.PROPERTY_READ) !== 0 && characteristicUUID.equals(c.getUuid())) {
        return c;
    }
  }
  
  // As a last resort, try and find ANY characteristic with this UUID, even if it doesn't have the correct properties
  return bluetoothGattService.getCharacteristic(characteristicUUID);
};      

Bluetooth._getWrapper = function (arg, reject) {
  if (!Bluetooth._isEnabled()) {
    reject("Bluetooth is not enabled");
    return;
  }
  if (!arg.deviceUUID) {
    reject("No deviceUUID was passed");
    return;
  }
  if (!arg.serviceUUID) {
    reject("No serviceUUID was passed");
    return;
  }
  if (!arg.characteristicUUID) {
    reject("No characteristicUUID was passed");
    return;
  }

  var serviceUUID = Bluetooth._stringToUuid(arg.serviceUUID);

  var stateObject = Bluetooth._connections[arg.deviceUUID];
  if (!stateObject) {
    reject("The device is disconnected");
    return;
  }

  var gatt = stateObject.device;
  var bluetoothGattService = gatt.getService(serviceUUID);

  if (!bluetoothGattService) {
    reject("Could not find service with UUID " + arg.serviceUUID + " on device with UUID " + arg.deviceUUID);
    return;
  }

  // with that all being checked, let's return a wrapper object containing all the stuff we found here
  return {
    gatt: gatt,
    bluetoothGattService: bluetoothGattService
  };
};

Bluetooth.read = function (arg) {
  return new Promise(function (resolve, reject) {
    try {
      var wrapper = Bluetooth._getWrapper(arg, reject);
      if (wrapper === null) {
        // no need to reject, this has already been done
        return;
      }

      var gatt = wrapper.gatt;
      var bluetoothGattService = wrapper.bluetoothGattService;
      var characteristicUUID = Bluetooth._stringToUuid(arg.characteristicUUID);

      var bluetoothGattCharacteristic = Bluetooth._findReadableCharacteristic(bluetoothGattService, characteristicUUID);
      if (!bluetoothGattCharacteristic) {
        reject("Could not find characteristic with UUID " + arg.characteristicUUID + " on service with UUID " + arg.serviceUUID + " on device with UUID " + arg.deviceUUID);
        return;
      }

      if (gatt.readCharacteristic(bluetoothGattCharacteristic)) {
        var stateObject = Bluetooth._connections[arg.deviceUUID];
        stateObject.onReadPromise = resolve;
      } else {
        reject("Failed to set client characteristic read for " + characteristicUUID);
      }
    } catch (ex) {
      console.log("Error in Bluetooth.read: " + ex);
      reject(ex);
    }
  });
};

Bluetooth.write = function (arg) {
  return new Promise(function (resolve, reject) {
    try {
      // TODO implement
      reject("write is not yet implemented for Android");
    } catch (ex) {
      console.log("Error in Bluetooth.write: " + ex);
      reject(ex);
    }
  });
};

Bluetooth.startNotifying = function (arg) {
  return new Promise(function (resolve, reject) {
    try {
      var wrapper = Bluetooth._getWrapper(arg, reject);
      if (wrapper === null) {
        // no need to reject, this has already been done
        return;
      }
      
      var gatt = wrapper.gatt;
      var bluetoothGattService = wrapper.bluetoothGattService;
      var characteristicUUID = Bluetooth._stringToUuid(arg.characteristicUUID);

      var bluetoothGattCharacteristic = Bluetooth._findNotifyCharacteristic(bluetoothGattService, characteristicUUID);
      if (!bluetoothGattCharacteristic) {
        reject("Could not find characteristic with UUID " + arg.characteristicUUID + " on service with UUID " + arg.serviceUUID + " on device with UUID " + arg.deviceUUID);
        return;
      }

      if (!gatt.setCharacteristicNotification(bluetoothGattCharacteristic, true)) {
        reject("Failed to register notification for characteristic " + arg.characteristicUUID);
        return;
      }

      var clientCharacteristicConfigId = Bluetooth._stringToUuid("2902");
      var bluetoothGattDescriptor = bluetoothGattCharacteristic.getDescriptor(clientCharacteristicConfigId);
      if (!bluetoothGattDescriptor) {
        reject("Set notification failed for " + characteristicUUID);
        return;
      }

      // prefer notify over indicate
      if ((bluetoothGattCharacteristic.getProperties() & android.bluetooth.BluetoothGattCharacteristic.PROPERTY_NOTIFY) !== 0) {
        bluetoothGattDescriptor.setValue(android.bluetooth.BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
      } else if ((bluetoothGattCharacteristic.getProperties() & android.bluetooth.BluetoothGattCharacteristic.PROPERTY_INDICATE) !== 0) {
        bluetoothGattDescriptor.setValue(android.bluetooth.BluetoothGattDescriptor.ENABLE_INDICATION_VALUE);
      } else {
        console.log("Characteristic " + characteristicUUID + " does not have NOTIFY or INDICATE property set");
      }

      if (gatt.writeDescriptor(bluetoothGattDescriptor)) {
        var cb = arg.onNotify || function(result) { console.log("No 'onNotify' callback function specified for 'startNotifying'"); };
        var stateObject = Bluetooth._connections[arg.deviceUUID];
        stateObject.onNotifyCallback = cb;
        console.log("--- notifying");
        resolve();
      } else {
        reject("Failed to set client characteristic notification for " + characteristicUUID);
      }
    } catch (ex) {
      console.log("Error in Bluetooth.startNotifying: " + ex);
      reject(ex);
    }
  });
};

// TODO lot of reuse between this and .startNotifying
Bluetooth.stopNotifying = function (arg) {
  return new Promise(function (resolve, reject) {
    try {
      var wrapper = Bluetooth._getWrapper(arg, reject);
      if (wrapper === null) {
        // no need to reject, this has already been done
        return;
      }
      
      var gatt = wrapper.gatt;
      var bluetoothGattService = wrapper.bluetoothGattService;
      var characteristicUUID = Bluetooth._stringToUuid(arg.characteristicUUID);

      var bluetoothGattCharacteristic = Bluetooth._findNotifyCharacteristic(bluetoothGattService, characteristicUUID);
      console.log("---- got gatt service char: " + bluetoothGattCharacteristic);

      if (!bluetoothGattCharacteristic) {
        reject("Could not find characteristic with UUID " + arg.characteristicUUID + " on service with UUID " + arg.serviceUUID + " on device with UUID " + arg.deviceUUID);
        return;
      }
      
      var stateObject = Bluetooth._connections[arg.deviceUUID];
      stateObject.onNotifyCallback = null;
      
      if (gatt.setCharacteristicNotification(bluetoothGattCharacteristic, false)) {
        resolve();
      } else {
        reject("Failed to remove client characteristic notification for " + characteristicUUID);
      }

    } catch (ex) {
      console.log("Error in Bluetooth.stopNotifying: " + ex);
      reject(ex);
    }
  });
};

module.exports = Bluetooth;