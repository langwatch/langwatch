import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import { Text, View } from "react-native";

import { Row, Screen, Section } from "@/ui/primitives";
import { useTheme } from "@/ui/theme";

/** Everything that is browsed rather than watched. */
export default function MoreScreen() {
  const theme = useTheme();
  const links: Array<{ title: string; icon: keyof typeof Ionicons.glyphMap; href: Href }> =
    [
      { title: "Scheduler", icon: "calendar-outline", href: "/scheduler" },
      { title: "The Foundry", icon: "hammer-outline", href: "/foundry" },
      { title: "Projection replay", icon: "film-outline", href: "/projections" },
    ];

  return (
    <Screen>
      <Section>
        {links.map((link, index) => (
          <LinkRow
            key={link.title}
            {...link}
            last={index === links.length - 1}
          />
        ))}
      </Section>

      <Section>
        <LinkRow title="Settings" icon="settings-outline" href="/settings" last />
      </Section>

      <Section title="What this app can do">
        <Row last>
          <Text style={{ color: theme.textMuted, fontSize: 13, lineHeight: 18 }}>
            This app monitors. Unblocking queues, redriving dead letters, pausing
            tenants, flipping feature flags and starting projection replays all
            stay in the web console.
          </Text>
        </Row>
      </Section>
    </Screen>
  );
}

function LinkRow({
  title,
  icon,
  href,
  last,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: Href;
  last: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Row onPress={() => router.push(href)} last={last}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Ionicons name={icon} size={20} color={theme.accent} />
        <Text style={{ color: theme.text, fontSize: 16, flex: 1 }}>{title}</Text>
        <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
      </View>
    </Row>
  );
}
