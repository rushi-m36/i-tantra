import React, { useState } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, Text, TextInput, TouchableOpacity, View } from "react-native";
import "../../global.css";
import { useCommunication } from "../context/CommunicationContext";
import { Device } from "../types/communication";

function DeviceCard({ device, onCall, isLoading }: { device: Device; onCall: () => void; isLoading: boolean }) {
  return (
    <View className="mb-3 border border-gray-200 bg-white p-5">
      <View className="flex-row items-center justify-between">
        <View className="flex-1">
          <Text className="text-lg font-bold text-black">{device.name}</Text>
          <Text className="mt-1 text-sm text-gray-500">{device.ip}</Text>
          <Text className="mt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {device.status === "available" ? "Available" : device.status}
          </Text>
        </View>
        <TouchableOpacity onPress={onCall} disabled={isLoading} activeOpacity={0.8} className="ml-4 h-11 min-w-20 items-center justify-center bg-black px-5">
          {isLoading ? <ActivityIndicator color="#fff" /> : <Text className="font-semibold text-white">Call</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function AvailableDevicesScreen() {
  const { devices, scanStatus, callDevice, callState, currentDevice } = useCommunication();
  const [loading, setLoading] = useState(false);
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [deviceIp, setDeviceIp] = useState("");
  const [deviceName, setDeviceName] = useState("");

  const handleCall = async (device: Device) => {
    setLoading(true);
    try {
      await callDevice(device);
    } catch (error) {
      Alert.alert("Call Failed", String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleAddDevice = () => {
    if (!deviceIp.trim() || !deviceName.trim()) {
      Alert.alert("Error", "Enter both the device name and IP address.");
      return;
    }
    const ip = deviceIp.trim();
    const newDevice: Device = {
      id: ip,
      name: deviceName.trim(),
      ip,
      port: 5555,
      status: "available",
      lastSeen: Date.now(),
    };
    void handleCall(newDevice);
    setDeviceIp("");
    setDeviceName("");
    setShowAddDevice(false);
  };

  if (callState !== "idle" && callState !== "incoming") {
    return (
      <View className="flex-1 bg-white px-6 pt-16">
        <Text className="text-xs font-semibold uppercase tracking-widest text-gray-500">
          {callState === "calling" ? "Calling" : "Connecting"}
        </Text>
        <Text className="mt-3 text-3xl font-bold text-black">{currentDevice?.name || "Device"}</Text>
        <Text className="mt-2 text-gray-500">Please wait...</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white px-6 pt-16">
      <View className="mb-6 flex-row items-end justify-between">
        <View>
          <Text className="text-xs font-semibold uppercase tracking-widest text-gray-500">iTantra</Text>
          <Text className="mt-2 text-3xl font-bold text-black">Devices</Text>
        </View>
        <TouchableOpacity onPress={() => setShowAddDevice(true)} activeOpacity={0.8} className="border border-black px-4 py-2">
          <Text className="font-semibold text-black">Add device</Text>
        </TouchableOpacity>
      </View>

      <View className="mb-5 border-y border-gray-200 py-4">
        {scanStatus.scanning ? (
          <View>
            <View className="flex-row items-center">
              <ActivityIndicator size="small" color="#000" />
              <Text className="ml-3 font-semibold text-black">Scanning local network</Text>
            </View>
            {scanStatus.currentIp && <Text className="mt-2 font-mono text-xs text-gray-500">{scanStatus.currentIp}</Text>}
            {scanStatus.total > 0 && (
              <Text className="mt-1 text-xs text-gray-500">
                {scanStatus.scanned} / {scanStatus.total} checked, {scanStatus.found} found
              </Text>
            )}
          </View>
        ) : devices.length > 0 ? (
          <Text className="font-semibold text-black">
            {devices.length} device{devices.length === 1 ? "" : "s"} found on this network
          </Text>
        ) : (
          <Text className="text-gray-500">No iTantra devices found on this network</Text>
        )}
      </View>

      <FlatList
        data={devices}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <DeviceCard
            device={item}
            onCall={() => void handleCall(item)}
            isLoading={loading && currentDevice?.id === item.id}
          />
        )}
        showsVerticalScrollIndicator={false}
      />

      <Modal visible={showAddDevice} transparent animationType="fade" onRequestClose={() => setShowAddDevice(false)}>
        <View className="flex-1 items-center justify-center bg-black/60 px-6">
          <View className="w-full max-w-md border border-black bg-white p-6">
            <Text className="text-xl font-bold text-black">Add device</Text>
            <Text className="mt-1 text-sm text-gray-500">Connect directly using the device IP address.</Text>
            <TextInput
              placeholder="Device name"
              value={deviceName}
              onChangeText={setDeviceName}
              placeholderTextColor="#888"
              className="mt-5 border border-gray-300 px-4 py-3 text-black"
            />
            <TextInput
              placeholder="IP address"
              value={deviceIp}
              onChangeText={setDeviceIp}
              keyboardType="decimal-pad"
              placeholderTextColor="#888"
              className="mt-3 border border-gray-300 px-4 py-3 text-black"
            />
            <View className="mt-5 flex-row gap-3">
              <TouchableOpacity onPress={() => setShowAddDevice(false)} className="flex-1 border border-black py-3">
                <Text className="text-center font-semibold text-black">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleAddDevice} className="flex-1 bg-black py-3">
                <Text className="text-center font-semibold text-white">Connect</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
