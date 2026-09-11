import { SymbolView } from "expo-symbols";
import { usePathname, useRouter } from "expo-router";
import { Text, TouchableOpacity, View } from "react-native";

export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const isHome = pathname === "/" || pathname === "/index";
  const isGuide = pathname === "/guide";

  const go = (path: "/" | "/guide") => {
    if (pathname !== path) router.replace(path);
  };

  return (
    <View style={{ paddingHorizontal: 24, paddingBottom: 18, paddingTop: 10, backgroundColor: "#080808" }}>
      <View style={{ height: 1, backgroundColor: "#222" }} />
      <View style={{ flexDirection: "row", paddingTop: 10 }}>
        <TouchableOpacity onPress={() => go("/")} activeOpacity={0.75} accessibilityRole="tab" accessibilityState={{ selected: isHome }} style={{ flex: 1, height: 52, alignItems: "center", justifyContent: "center" }}>
          <SymbolView name="house.fill" size={20} tintColor={isHome ? "#fff" : "#666"} />
          <Text style={{ marginTop: 5, fontSize: 11, fontWeight: isHome ? "600" : "500", color: isHome ? "#fff" : "#666" }}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => go("/guide")} activeOpacity={0.75} accessibilityRole="tab" accessibilityState={{ selected: isGuide }} style={{ flex: 1, height: 52, alignItems: "center", justifyContent: "center" }}>
          <SymbolView name="book.closed.fill" size={20} tintColor={isGuide ? "#fff" : "#666"} />
          <Text style={{ marginTop: 5, fontSize: 11, fontWeight: isGuide ? "600" : "500", color: isGuide ? "#fff" : "#666" }}>Guide</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
