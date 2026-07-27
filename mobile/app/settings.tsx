import { Stack } from "expo-router";
import { Alert, Text } from "react-native";

import { trpc } from "@/api/trpc";
import { useAuth } from "@/auth/AuthProvider";
import { instanceDisplayName } from "@/lib/instanceUrl";
import { sessionDisplayName } from "@/lib/session";
import { Button, DetailRow, Row, Screen, Section } from "@/ui/primitives";
import { useTheme } from "@/ui/theme";

export default function SettingsScreen() {
  const theme = useTheme();
  const { session, signOut } = useAuth();

  // The scope probe answers for a non-operator instead of failing, so this is
  // the one place that can tell "your account cannot see ops" apart from "the
  // network is down".
  const scope = trpc.ops.getScope.useQuery();
  const hasOpsAccess = scope.data?.scope.kind !== "none";

  return (
    <>
      <Stack.Screen options={{ title: "Settings" }} />
      <Screen>
        {session ? (
          <Section title="Signed in">
            <DetailRow label="Account" value={sessionDisplayName(session)} />
            {session.userEmail &&
            session.userEmail !== sessionDisplayName(session) ? (
              <DetailRow label="Email" value={session.userEmail} />
            ) : null}
            {session.organizationName ? (
              <DetailRow label="Organization" value={session.organizationName} />
            ) : null}
            <DetailRow
              label="Instance"
              value={instanceDisplayName(session.instance)}
              last
            />
          </Section>
        ) : null}

        {scope.data && !hasOpsAccess ? (
          <Section title="Ops access">
            <Row last>
              <Text style={{ color: theme.warning, fontSize: 13, lineHeight: 18 }}>
                This account is not a platform operator on this instance, so the
                ops screens have nothing to show. Sign in with an operator
                account to continue.
              </Text>
            </Row>
          </Section>
        ) : null}

        <Section footer="Signing out removes the stored credential from this device. It does not revoke other devices.">
          <Row last>
            <Button
              title="Sign out"
              destructive
              onPress={() =>
                Alert.alert("Sign out of LangWatch Ops?", undefined, [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Sign out",
                    style: "destructive",
                    onPress: () => void signOut(),
                  },
                ])
              }
            />
          </Row>
        </Section>

        <Section title="What this app can do">
          <Row last>
            <Text style={{ color: theme.textMuted, fontSize: 13, lineHeight: 18 }}>
              This app monitors. The only action it can take is the payload store
              cleanup sweep, and that is trialled before it runs. Unblocking
              queues, redriving dead letters, pausing tenants, flipping feature
              flags and starting projection replays all stay in the web console.
            </Text>
          </Row>
        </Section>
      </Screen>
    </>
  );
}
