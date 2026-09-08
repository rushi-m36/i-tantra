import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import "../../global.css";
import { useCommunication } from "../context/CommunicationContext";
import { Device } from "../types/communication";

function DeviceCard({
  device,
  onCall,
  isLoading,
}: {
  device: Device;
  onCall: () => void;
  isLoading: boolean;
}) {
  return (
    <View className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
      <Text className="text-lg font-bold text-gray-900">{device.name}</Text>
      <Text className="mt-1 text-sm text-gray-500">{device.ip}</Text>
      <Text className="mt-1 text-sm text-gray-600">
        {device.status === "available" ? "Available" : device.status}
      </Text>
      <TouchableOpacity
        onPress={onCall}
        disabled={isLoading}
        className="mt-3 rounded-lg bg-blue-500 py-3 px-4"
      >
        {isLoading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text className="text-center font-semibold text-white">Call</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

export default function AvailableDevicesScreen() {
  const { devices, startServer, callDevice, callState, currentDevice } =
    useCommunication();
  const [loading, setLoading] = useState(false);
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [deviceIp, setDeviceIp] = useState("");
  const [deviceName, setDeviceName] = useState("");

  React.useEffect(() => {
    startServer();
  }, [startServer]);

  const handleCall = async (device: Device) => {
    setLoading(true);
    try {
      await callDevice(device);
    } catch (e) {
      Alert.alert("Call Failed", String(e));
      console.error("Call failed:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleAddDevice = () => {
    if (!deviceIp.trim() || !deviceName.trim()) {
      Alert.alert("Error", "Please enter both device name and IP address");
      return;
    }

    const newDevice: Device = {
      id: deviceIp,
      name: deviceName,
      ip: deviceIp,
      port: 5555,
      status: "available",
      lastSeen: Date.now(),
    };

    handleCall(newDevice);
    setDeviceIp("");
    setDeviceName("");
    setShowAddDevice(false);
  };

  if (callState !== "idle" && callState !== "incoming") {
    return (
      <View className="flex-1 bg-white px-6 pt-16">
        <Text className="text-2xl font-bold text-gray-900">
          {callState === "calling" ? "Calling..." : "Connecting..."}
        </Text>
        {currentDevice && (
          <Text className="mt-4 text-lg text-gray-700">
            {currentDevice.name}
          </Text>
        )}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white px-6 pt-16">
      <View className="mb-4 flex-row items-center justify-between">
        <Text className="text-3xl font-bold text-black">Available Devices</Text>
        <TouchableOpacity
          onPress={() => setShowAddDevice(true)}
          className="rounded-lg bg-green-500 px-3 py-2"
        >
          <Text className="font-semibold text-white">+ Add</Text>
        </TouchableOpacity>
      </View>

      {devices.length === 0 ? (
        <View className="mt-8">
          <Text className="text-gray-600">
            No devices found. Use the + Add button to manually add a device IP.
          </Text>
        </View>
      ) : (
        <FlatList
          data={devices}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <DeviceCard
              device={item}
              onCall={() => handleCall(item)}
              isLoading={loading && currentDevice?.id === item.id}
            />
          )}
          scrollEnabled={false}
          className="mt-6"
        />
      )}

      <Modal visible={showAddDevice} transparent animationType="slide">
        <View className="flex-1 bg-black bg-opacity-50 p-6 pt-32">
          <View className="rounded-lg bg-white p-6">
            <Text className="text-xl font-bold text-gray-900">
              Add Device Manually
            </Text>

            <TextInput
              placeholder="Device Name (e.g., Friend's Phone)"
              value={deviceName}
              onChangeText={setDeviceName}
              className="mt-4 rounded-lg border border-gray-300 p-3 text-gray-900"
              placeholderTextColor="#999"
            />

            <TextInput
              placeholder="Device IP Address (e.g., 192.168.1.100)"
              value={deviceIp}
              onChangeText={setDeviceIp}
              className="mt-3 rounded-lg border border-gray-300 p-3 text-gray-900"
              keyboardType="decimal-pad"
              placeholderTextColor="#999"
            />

            <View className="mt-6 flex-row justify-end gap-3">
              <TouchableOpacity
                onPress={() => {
                  setShowAddDevice(false);
                  setDeviceIp("");
                  setDeviceName("");
                }}
                className="rounded-lg bg-gray-300 px-4 py-2"
              >
                <Text className="font-semibold text-gray-900">Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleAddDevice}
                className="rounded-lg bg-blue-500 px-4 py-2"
              >
                <Text className="font-semibold text-white">Add & Call</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
