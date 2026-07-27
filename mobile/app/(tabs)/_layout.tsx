import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

import { trpc } from "@/api/trpc";
import { useTheme } from "@/ui/theme";

/**
 * Five tabs, matching the ops side menu on the web: the dashboard, the queues,
 * what is broken, the payload store, and everything that is browsed rather than
 * watched.
 */
export default function TabsLayout() {
  const theme = useTheme();

  // The cheap counts-only query, which the server memoizes separately from the
  // full dashboard aggregation — safe to keep polling for a badge.
  const badge = trpc.ops.getBadgeCounts.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const alerts = (badge.data?.blockedCount ?? 0) + (badge.data?.dlqCount ?? 0);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.accent,
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        tabBarStyle: { backgroundColor: theme.card },
        sceneStyle: { backgroundColor: theme.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Overview",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="speedometer-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="queues"
        options={{
          title: "Queues",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="layers-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="health"
        options={{
          title: "Health",
          tabBarBadge: alerts > 0 ? alerts : undefined,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="pulse-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="storage"
        options={{
          title: "Storage",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="server-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="ellipsis-horizontal" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
