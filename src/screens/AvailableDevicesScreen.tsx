import React, { useState } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, Text, TextInput, TouchableOpacity, View } from "react-native";
import "../../global.css";
import { useCommunication } from "../context/CommunicationContext";
import { Device } from "../types/communication";

function DeviceCard({ device, onCall, isLoading }: { device: Device; onCall: () => void; isLoading: boolean }) {
  return (
    <View style={{ marginBottom: 12, borderWidth: 1, borderColor: "#333", backgroundColor: "#080808", padding: 20 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 18, fontWeight: "700", color: "#fff" }}>{device.name}</Text>
          <Text style={{ marginTop: 4, fontSize: 14, color: "#aaa" }}>{device.ip}</Text>
          <Text style={{ marginTop: 8, fontSize: 11, fontWeight: "600", color: "#aaa", textTransform: "uppercase", letterSpacing: 1 }}>{device.status === "available" ? "Available" : device.status}</Text>
        </View>
        <TouchableOpacity onPress={onCall} disabled={isLoading} activeOpacity={0.8} style={{ marginLeft: 16, minWidth: 80, height: 44, alignItems: "center", justifyContent: "center", backgroundColor: "#fff", paddingHorizontal: 20 }}>
          {isLoading ? <ActivityIndicator color="#000" /> : <Text style={{ fontWeight: "700", color: "#000" }}>Call</Text>}
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
    try { await callDevice(device); } catch (error) { Alert.alert("Call Failed", String(error)); } finally { setLoading(false); }
  };

  const handleAddDevice = () => {
    if (!deviceIp.trim() || !deviceName.trim()) { Alert.alert("Error", "Enter both the device name and IP address."); return; }
    const ip = deviceIp.trim();
    const newDevice: Device = { id: ip, name: deviceName.trim(), ip, port: 5555, status: "available", lastSeen: Date.now() };
    void handleCall(newDevice);
    setDeviceIp(""); setDeviceName(""); setShowAddDevice(false);
  };

  if (callState !== "idle" && callState !== "incoming") {
    return (
      <View style={{ flex: 1, backgroundColor: "#080808", paddingHorizontal: 24, paddingTop: 64 }}>
        <Text style={{ fontSize: 11, fontWeight: "600", letterSpacing: 2, color: "#aaa", textTransform: "uppercase" }}>{callState === "calling" ? "Calling" : "Connecting"}</Text>
        <Text style={{ marginTop: 12, fontSize: 30, fontWeight: "700", color: "#fff" }}>{currentDevice?.name || "Device"}</Text>
        <Text style={{ marginTop: 8, color: "#888" }}>Please wait...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#080808", paddingHorizontal: 24, paddingTop: 64 }}>
      <View style={{ marginBottom: 24, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
        <View>
          <Text style={{ fontSize: 11, fontWeight: "600", letterSpacing: 2, color: "#aaa", textTransform: "uppercase" }}>iTantra</Text>
          <Text style={{ marginTop: 8, fontSize: 30, fontWeight: "700", color: "#fff" }}>Devices</Text>
        </View>
        <TouchableOpacity onPress={() => setShowAddDevice(true)} activeOpacity={0.8} style={{ borderWidth: 1, borderColor: "#fff", paddingHorizontal: 16, paddingVertical: 9 }}>
          <Text style={{ fontWeight: "600", color: "#fff" }}>Add device</Text>
        </TouchableOpacity>
      </View>

      <View style={{ marginBottom: 20, borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#333", paddingVertical: 16 }}>
        {scanStatus.scanning ? (
          <View>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={{ marginLeft: 12, fontWeight: "600", color: "#fff" }}>Scanning local network</Text>
            </View>
            {scanStatus.currentIp && <Text style={{ marginTop: 8, fontSize: 12, color: "#888" }}>{scanStatus.currentIp}</Text>}
            {scanStatus.total > 0 && <Text style={{ marginTop: 4, fontSize: 12, color: "#888" }}>{scanStatus.scanned} / {scanStatus.total} checked, {scanStatus.found} found</Text>}
          </View>
        ) : devices.length > 0 ? (
          <Text style={{ fontWeight: "600", color: "#fff" }}>{devices.length} device{devices.length === 1 ? "" : "s"} found on this network</Text>
        ) : (
          <Text style={{ color: "#888" }}>No iTantra devices found on this network</Text>
        )}
      </View>

      <FlatList data={devices} keyExtractor={(item) => item.id} renderItem={({ item }) => <DeviceCard device={item} onCall={() => void handleCall(item)} isLoading={loading && currentDevice?.id === item.id} />} showsVerticalScrollIndicator={false} />

      <Modal visible={showAddDevice} transparent animationType="fade" onRequestClose={() => setShowAddDevice(false)}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.85)", paddingHorizontal: 24 }}>
          <View style={{ width: "100%", maxWidth: 420, borderWidth: 1, borderColor: "#fff", backgroundColor: "#080808", padding: 24 }}>
            <Text style={{ fontSize: 20, fontWeight: "700", color: "#fff" }}>Add device</Text>
            <Text style={{ marginTop: 4, fontSize: 14, color: "#888" }}>Connect directly using the device IP address.</Text>
            <TextInput placeholder="Device name" value={deviceName} onChangeText={setDeviceName} placeholderTextColor="#777" style={{ marginTop: 20, borderWidth: 1, borderColor: "#333", paddingHorizontal: 16, paddingVertical: 12, color: "#fff" }} />
            <TextInput placeholder="IP address" value={deviceIp} onChangeText={setDeviceIp} keyboardType="decimal-pad" placeholderTextColor="#777" style={{ marginTop: 12, borderWidth: 1, borderColor: "#333", paddingHorizontal: 16, paddingVertical: 12, color: "#fff" }} />
            <View style={{ marginTop: 20, flexDirection: "row", gap: 12 }}>
              <TouchableOpacity onPress={() => setShowAddDevice(false)} style={{ flex: 1, borderWidth: 1, borderColor: "#fff", paddingVertical: 12 }}><Text style={{ textAlign: "center", fontWeight: "600", color: "#fff" }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={handleAddDevice} style={{ flex: 1, backgroundColor: "#fff", paddingVertical: 12 }}><Text style={{ textAlign: "center", fontWeight: "700", color: "#000" }}>Connect</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
