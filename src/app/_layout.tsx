import { Stack } from "expo-router";
import { CommunicationProvider } from "../context/CommunicationContext";

export default function RootLayout() {
  return (
    <CommunicationProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </CommunicationProvider>
  );
}
