import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { SignInScreen } from "@/auth/SignInScreen";
import { useTheme } from "@/ui/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

/**
 * Sign-in is rendered in place rather than as a route.
 *
 * A signed-out app has exactly one screen and no navigation history worth
 * keeping, and routing to it would mean every deep link needs to know about the
 * redirect. The tabs only exist once there is a session behind them.
 */
function Gate() {
  const { status } = useAuth();
  const theme = useTheme();

  if (status === "restoring") {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.background,
        }}
      >
        <ActivityIndicator />
      </View>
    );
  }

  if (status === "signedOut") return <SignInScreen />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
