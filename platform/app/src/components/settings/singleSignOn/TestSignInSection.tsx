import { Alert, Button, Text, VStack } from "@chakra-ui/react";
import type { SelfServeGoLiveView } from "@langwatch/identity-server";
import { useTestSignIn } from "~/features/sso/hooks/useTestSignIn";

/**
 * Proving the connection carries a real person.
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
  const { start, sending } = useTestSignIn({ connectionId });

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
