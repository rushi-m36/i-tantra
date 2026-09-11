import { Platform } from "react-native";

if (!__DEV__ && Platform.OS !== "web") {
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
  console.warn = () => {};
}
