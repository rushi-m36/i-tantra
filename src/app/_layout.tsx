import { Stack } from "expo-router";
import "../utils/production";
import { CommunicationProvider } from "../context/CommunicationContext";
import { DiscoveryLifecycle } from "../components/DiscoveryLifecycle";

export default function RootLayout() {
  return (
    <CommunicationProvider>
      <DiscoveryLifecycle />
      <Stack screenOptions={{ headerShown: false }} />
    </CommunicationProvider>
  );
}
