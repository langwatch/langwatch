import { Alert, Button, Text, VStack } from "@chakra-ui/react";
import type { SelfServeGoLiveView } from "@langwatch/identity-server";
import { ExternalLink, RefreshCw } from "lucide-react";
import { TestSignInFailureNotice } from "~/features/sso/components/TestSignInFailureNotice";
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
  const { start, sending, failure } = useTestSignIn({ connectionId });

  return (
    <VStack align="stretch" gap={3}>
      <Text color="fg.muted" fontSize="sm">
        This sends you to {providerName} to sign in, then brings you back here.
        Going live rests on a sign-in that actually worked, so this is the step
        that proves the connection carries a real person — not a setting we can
        tick for you.
      </Text>
      {failure && <TestSignInFailureNotice failure={failure} />}
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
          // A failed attempt is still the step to do, so the button stays
          // solid — an outline button after a failure reads as "this is
          // finished, do it again if you like".
          variant={testSignIn.done && !failure ? "outline" : "solid"}
          loading={sending}
          onClick={() => void start()}
        >
          {/* IT LEAVES. Pressing this hands the browser to somebody else's
              sign-in screen and brings it back, which is not what a plain
              button promises — so it is marked the way every other control
              that navigates away is, and a repeat is marked as a repeat. */}
          {(failure ?? testSignIn.done) ? (
            <RefreshCw size={14} />
          ) : (
            <ExternalLink size={14} />
          )}
          {failure
            ? "Try the sign-in again"
            : testSignIn.done
              ? "Test it again"
              : "Test sign-in"}
        </Button>
      )}
    </VStack>
  );
}
