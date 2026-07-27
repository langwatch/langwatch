import * as WebBrowser from "expo-web-browser";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Platform, Text, TextInput, View } from "react-native";

import { PRODUCTION_INSTANCE, parseInstanceUrl } from "@/lib/instanceUrl";
import {
  Button,
  DetailRow,
  Row,
  Screen,
  Section,
  styles,
} from "@/ui/primitives";
import { useTheme } from "@/ui/theme";

import { useAuth } from "./AuthProvider";
import {
  DeviceFlowError,
  exchangeDeviceCode,
  requestDeviceCode,
  type DeviceChallenge,
} from "./deviceFlow";

type Phase =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "awaiting"; challenge: DeviceChallenge }
  | { kind: "failed"; message: string };

/**
 * Sign-in via the device-authorization flow.
 *
 * The app never handles a password — approval happens on the instance's own
 * page in a browser, so single sign-on, MFA and anything else the instance
 * enforces stay enforced.
 */
export function SignInScreen() {
  const theme = useTheme();
  const { signIn } = useAuth();
  const [text, setText] = useState(PRODUCTION_INSTANCE.replace("https://", ""));
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const cancelled = useRef(false);

  const instance = parseInstanceUrl(text);

  const start = useCallback(async () => {
    if (!instance) return;
    cancelled.current = false;
    setPhase({ kind: "requesting" });

    try {
      const challenge = await requestDeviceCode(instance);
      if (cancelled.current) return;
      setPhase({ kind: "awaiting", challenge });

      await WebBrowser.openBrowserAsync(challenge.verificationUrl);
      const session = await poll({ instance, challenge, cancelled });
      if (cancelled.current || !session) return;
      await signIn(session);
    } catch (error) {
      if (cancelled.current) return;
      setPhase({
        kind: "failed",
        message:
          error instanceof Error ? error.message : "Sign-in failed. Try again.",
      });
    }
  }, [instance, signIn]);

  const poll = useCallback(
    async ({
      instance: origin,
      challenge,
      cancelled: flag,
    }: {
      instance: string;
      challenge: DeviceChallenge;
      cancelled: { current: boolean };
    }) => {
      // Start at the server's advertised interval and back off on `slow_down`,
      // which is what RFC 8628 asks of a client and what the server's own rate
      // limiter enforces anyway.
      let intervalSeconds = challenge.pollIntervalSeconds;

      while (!flag.current) {
        if (Date.now() >= challenge.expiresAt) {
          setPhase({
            kind: "failed",
            message: "The sign-in request expired. Start again.",
          });
          return null;
        }

        await sleep(intervalSeconds * 1000);
        if (flag.current) return null;

        try {
          return await exchangeDeviceCode({
            instance: origin,
            deviceCode: challenge.deviceCode,
            deviceLabel: `${Platform.OS} device`,
          });
        } catch (error) {
          if (!(error instanceof DeviceFlowError)) throw error;
          if (error.kind === "authorization_pending") continue;
          if (error.kind === "slow_down") {
            intervalSeconds += 2;
            continue;
          }
          setPhase({ kind: "failed", message: error.message });
          return null;
        }
      }
      return null;
    },
    [],
  );

  return (
    <Screen>
      <Section
        title="LangWatch instance"
        footer="The address you open LangWatch at. Self-hosted instances work too."
      >
        <Row last>
          <TextInput
            value={text}
            onChangeText={setText}
            editable={phase.kind === "idle" || phase.kind === "failed"}
            placeholder="app.langwatch.ai"
            placeholderTextColor={theme.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={{ color: theme.text, fontSize: 16, paddingVertical: 4 }}
          />
        </Row>
      </Section>

      {phase.kind === "awaiting" ? (
        <Section
          title="Confirm this code in the browser"
          footer="Approval happens on your instance, so single sign-on and two-factor stay in force."
        >
          <Row>
            <Text
              selectable
              accessibilityLabel={spellOut(phase.challenge.userCode)}
              style={{
                color: theme.text,
                fontSize: 34,
                fontWeight: "700",
                letterSpacing: 4,
                textAlign: "center",
                fontFamily: "Menlo",
              }}
            >
              {phase.challenge.userCode}
            </Text>
          </Row>
          <Row>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <ActivityIndicator size="small" />
              <Text style={{ color: theme.textMuted, fontSize: 13 }}>
                Waiting for approval…
              </Text>
            </View>
          </Row>
          <Row>
            <Button
              title="Open browser again"
              onPress={() => {
                void WebBrowser.openBrowserAsync(phase.challenge.verificationUrl);
              }}
            />
          </Row>
          <Row last>
            <Button
              title="Cancel"
              onPress={() => {
                cancelled.current = true;
                setPhase({ kind: "idle" });
              }}
            />
          </Row>
        </Section>
      ) : (
        <Section footer="Approval happens in your browser — this app never handles your password.">
          <Row last>
            {phase.kind === "requesting" ? (
              <View style={styles.centered}>
                <ActivityIndicator />
              </View>
            ) : (
              <Button
                title="Sign in"
                onPress={() => void start()}
                disabled={!instance}
              />
            )}
          </Row>
        </Section>
      )}

      {phase.kind === "failed" ? (
        <Section title="Could not sign in">
          <Row last>
            <Text style={{ color: theme.warning, fontSize: 13 }}>
              {phase.message}
            </Text>
          </Row>
        </Section>
      ) : null}

      {instance ? (
        <Section title="Connecting to">
          <DetailRow label="Instance" value={instance} mono last />
        </Section>
      ) : null}
    </Screen>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * "W, D, J, B, dash, M, J, H, T" — a screen reader renders an unspaced code as
 * a mangled word otherwise, and this code has to be matched by eye against the
 * browser.
 */
function spellOut(code: string): string {
  return code
    .split("")
    .map((character) => (character === "-" ? "dash" : character))
    .join(", ");
}
