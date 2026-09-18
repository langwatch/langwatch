import { Alert, Button, Code, Text, VStack } from "@chakra-ui/react";
import { TestFromAnotherBrowser } from "@ee/sso/components/TestFromAnotherBrowser";
import { TestSignInFailureNotice } from "@ee/sso/components/TestSignInFailureNotice";
import { useTestSignIn } from "@ee/sso/hooks/useTestSignIn";
import {
  type TestSignInAddressNote,
  testSignInAddressNote,
} from "@ee/sso/logic/testSignInAddress";
import type { SelfServeGoLiveView } from "@ee/sso/sso-self-serve.types";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useSession } from "~/utils/auth-client";

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
  connectionState,
  verifiedDomains,
}: {
  connectionId: string;
  providerName: string;
  canManage: boolean;
  testSignIn: SelfServeGoLiveView["testSignIn"];
  connectionState: string;
  verifiedDomains: readonly string[];
}) {
  const { start, sending, failure } = useTestSignIn({ connectionId });
  const { data: session } = useSession();
  const addressNote = testSignInAddressNote({
    connectionState,
    verifiedDomains,
    yourAddress: session?.user?.email,
  });

  return (
    <VStack align="stretch" gap={3}>
      <Text color="fg.muted" fontSize="sm">
        This sends you to {providerName} to sign in, then brings you back here.
        Going live rests on a sign-in that actually worked, so this is the step
        that proves the connection carries a real person, not a setting we can
        tick for you.
      </Text>
      {/* SAID BEFORE IT IS PRESSED. What follows a success is already handled
          well: somebody who comes back as a different person lands on a page
          that says the test worked, names the address the session is now held
          as, and offers the way back to their own account. That is the right
          place to RECOVER from it and the wrong place to first hear of it,
          and "brings you back here" above reads like a round trip that
          returns you as yourself. */}
      <Text
        color="fg.muted"
        fontSize="sm"
        data-testid="test-sign-in-session-note"
      >
        It is a real sign-in, so a success replaces the session you are reading
        this with. If {providerName} signs you in as somebody other than
        yourself, you come back as them, and we offer you the way back to your
        own account.
      </Text>
      {/* BEFORE the button, and above a failure that has already happened:
          this is the thing that stops the next attempt being wasted the same
          way as the last one. */}
      {addressNote && (
        <TestSignInAddressNotice
          note={addressNote}
          providerName={providerName}
        />
      )}
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
 * Which address this test will actually accept, said before it is pressed.
 *
 * The one-address rule is the least guessable thing about the setup journey:
 * a connection that is not live yet accepts only the address belonging to
 * whoever registered it, so signing in at the provider as anybody else — or
 * as an address on the very domain the connection is being built for — comes
 * back refused. Somebody reading that refusal has already spent a round trip
 * to their provider to learn it.
 *
 * It escalates from a note to a warning at the point we can SEE the mismatch:
 * the reader's own address is on none of the domains this connection has
 * proved, so whatever the provider asserts is unlikely to be the one address
 * that would work.
 */
function TestSignInAddressNotice({
  note,
  providerName,
}: {
  note: TestSignInAddressNote;
  providerName: string;
}) {
  return (
    <Alert.Root status={note.tone} data-testid="test-sign-in-address-note">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>
          {note.addressIsOffDomain
            ? "Your account is not on this connection's domain"
            : "Only one address can sign in while this is being set up"}
        </Alert.Title>
        <Alert.Description>
          <VStack align="stretch" gap={2}>
            <Text fontSize="sm">
              Until the domain is verified and the connection is live, run this
              test as the person whose LangWatch account registered the
              connection. Your current address is{" "}
              <Code fontSize="xs">{note.yourAddress}</Code>; if that is not the
              registering account, LangWatch will refuse the sign-in.
            </Text>
            {note.addressIsOffDomain && (
              <Text fontSize="sm">
                This connection is set up for{" "}
                {note.connectionDomains.join(", ")}, so an address there is not
                accepted yet. What opens it is finishing the rest of this page:
                prove the domain, name someone who can still get in, and say who
                it lets in. All three, not just the domain.
              </Text>
            )}
          </VStack>
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
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
