import { Alert, Button, Text, VStack } from "@chakra-ui/react";
import type { SelfServeGoLiveView } from "@langwatch/identity-server";
import { useState } from "react";
import { authClient } from "../../../utils/auth-client";
import { toaster } from "../../ui/toaster";
import { reportRefusal } from "./refusals";

/**
 * Proving the connection carries a real person.
 *
 * The button goes to the identity provider NAMING THIS CONNECTION rather
 * than through the auth screens, and that is what makes the test possible
 * before the organization's sign-in has been switched over: proving the
 * connection has to be something an administrator can do while nothing about
 * anybody else's sign-in has changed, or the only way to find out whether it
 * works would be to make everyone depend on it first.
 *
 * Nothing here records anything, and there is no verb for it. The account
 * the sign-in leaves behind IS the record, which is why this step cannot be
 * ticked by pressing a button — only by coming back.
 */
export function TestSignInSection({
  connectionId,
  providerName,
  canManage,
  testSignIn,
}: {
  connectionId: string;
  providerName: string;
  canManage: boolean;
  testSignIn: SelfServeGoLiveView["testSignIn"];
}) {
  const [sending, setSending] = useState(false);

  const start = async () => {
    setSending(true);
    try {
      const { error } = await authClient.signIn.sso({
        providerId: connectionId,
        // Back to this page, so the tick is the first thing they see.
        callbackURL: window.location.href,
      });
      if (error) {
        // Not a handled payload: this comes back from the identity provider
        // or from the engine talking to it, so there is no code of ours to
        // key copy off. What the reader can act on is checking the values
        // they gave us against the application they created.
        toaster.create({
          title: "That sign-in didn't complete",
          description:
            "Your identity provider turned the request away. Check the values you gave us against the application you created there, then try again.",
          type: "error",
          duration: 8000,
        });
      }
    } catch (error) {
      reportRefusal(error);
    } finally {
      setSending(false);
    }
  };

  return (
    <VStack align="stretch" gap={3}>
      <Text color="fg.muted">
        This sends you to {providerName} to sign in, then brings you back here.
        Going live rests on a sign-in that actually worked, so this is the step
        that proves the connection carries a real person — not a setting we can
        tick for you.
      </Text>
      {testSignIn.done && (
        <Alert.Root status="success">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>A sign-in through this connection worked</Alert.Title>
            <Alert.Description>
              {testSignIn.atMs
                ? `The last one was on ${new Date(testSignIn.atMs).toLocaleString()}.`
                : "You can test it again at any time."}
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}
      {canManage && (
        <Button
          alignSelf="start"
          variant={testSignIn.done ? "outline" : "solid"}
          loading={sending}
          onClick={() => void start()}
        >
          {testSignIn.done ? "Test it again" : "Test sign-in"}
        </Button>
      )}
    </VStack>
  );
}
