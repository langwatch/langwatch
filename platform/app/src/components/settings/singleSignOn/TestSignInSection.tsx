import { Alert, Button, Text, VStack } from "@chakra-ui/react";
import type { SelfServeGoLiveView } from "@langwatch/identity-server";
import { ExternalLink, RefreshCw } from "lucide-react";
import { TestFromAnotherBrowser } from "~/features/sso/components/TestFromAnotherBrowser";
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
        <TestSignInButton
          done={testSignIn.done}
          failed={failure !== undefined && failure !== null}
          sending={sending}
          onStart={() => void start()}
        />
      )}
      {/* AS SOMEBODY WHO IS NOT YOU, which is the test that actually proves
          the connection: signing in as the administrator who registered it
          exercises a path most of the organization will never take. */}
      {canManage && <TestFromAnotherBrowser />}
    </VStack>
  );
}

/**
 * The control that hands the browser to the identity provider.
 *
 * A failed attempt is still the step to do, so the button stays SOLID — an
 * outline button after a failure reads as "this is finished, do it again if
 * you like". It leaves the application, so it carries the same mark every
 * other control that navigates away does, and a repeat is marked as a repeat.
 */
function TestSignInButton({
  done,
  failed,
  sending,
  onStart,
}: {
  done: boolean;
  failed: boolean;
  sending: boolean;
  onStart: () => void;
}) {
  return (
    <Button
      alignSelf="start"
      variant={done && !failed ? "outline" : "solid"}
      loading={sending}
      onClick={onStart}
    >
      {failed || done ? <RefreshCw size={14} /> : <ExternalLink size={14} />}
      {failed
        ? "Try the sign-in again"
        : done
          ? "Test it again"
          : "Test sign-in"}
    </Button>
  );
}
