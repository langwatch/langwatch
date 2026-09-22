// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Proving the connection carries a real person. Nothing here records
 * anything and there is no verb for it: the account the sign-in leaves behind
 * IS the record, which is why this step cannot be ticked by pressing a button
 * — only by coming back. Spec: specs/identity/sso-activation.feature.
 */
import { Alert, Button, Code, Text, VStack } from "@chakra-ui/react";
import { format } from "@langwatch/time";
import { ExternalLink, RefreshCw } from "lucide-react";

import { useTestSignIn } from "../../behavior/use-test-sign-in.ts";
import { useSsoHost } from "../../model/sso-host.ts";
import {
  testSignInAddressNote,
  type TestSignInAddressNote,
} from "../../model/test-sign-in-address.ts";
import { TestFromAnotherBrowser } from "../elements/test-from-another-browser.tsx";
import { TestSignInFailureNotice } from "../elements/test-sign-in-failure-notice.tsx";

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
  /** Whether a sign-in through this connection has ever worked, and when. */
  testSignIn: { done: boolean; atMs: number | null };
  connectionState: string;
  verifiedDomains: readonly string[];
}) {
  const host = useSsoHost();
  const { start, sending, failure } = useTestSignIn({ connectionId });
  const addressNote = testSignInAddressNote({
    connectionState,
    verifiedDomains,
    yourAddress: host.currentUserAddress(),
  });

  return (
    <VStack align="stretch" gap={3}>
      <Text color="fg.muted" fontSize="sm">
        This sends you to {providerName} to sign in, then brings you back here. Going live rests on
        a sign-in that actually worked, so this is the step that proves the connection carries a
        real person, not a setting we can tick for you.
      </Text>
      {/* Said BEFORE it is pressed: the one consequence an administrator
          cannot undo by reading further is being signed out of the session
          they are configuring the connection with. */}
      <Text color="fg.muted" fontSize="sm" data-testid="test-sign-in-session-note">
        It is a real sign-in, so a success replaces the session you are reading this with. If{" "}
        {providerName} signs you in as somebody other than yourself, you come back as them, and we
        offer you the way back to your own account.
      </Text>
      {/* Before the button, and above a failure that has already happened:
          this is what stops the next attempt being wasted like the last. */}
      {addressNote && <TestSignInAddressNotice note={addressNote} />}
      {failure && <TestSignInFailureNotice failure={failure} />}
      {testSignIn.done && (
        <Alert.Root status="success">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>A sign-in through this connection worked</Alert.Title>
            <Alert.Description>
              {testSignIn.atMs === null
                ? "You can test it again at any time."
                : `The last one was on ${format(testSignIn.atMs, "d MMMM yyyy, HH:mm")}.`}
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}
      {canManage && (
        <TestSignInButton
          done={testSignIn.done}
          failed={failure !== null}
          sending={sending}
          onStart={() => void start()}
        />
      )}
      {/* As somebody who is not you, which is the test that actually proves
          the connection: signing in as the administrator who registered it
          exercises a path most of the organization will never take. */}
      {canManage && <TestFromAnotherBrowser />}
    </VStack>
  );
}

/**
 * Which address this test will accept, said before it is pressed. A
 * connection that is not live yet accepts exactly the address belonging to
 * whoever registered it, and that is the least guessable thing about the
 * journey — learning it from a refusal costs a round trip to the provider.
 */
function TestSignInAddressNotice({ note }: { note: TestSignInAddressNote }) {
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
              Until the domain is verified and the connection is live, run this test as the person
              whose LangWatch account registered the connection. Your current address is{" "}
              <Code fontSize="xs">{note.yourAddress}</Code>; if that is not the registering account,
              LangWatch will refuse the sign-in.
            </Text>
            {note.addressIsOffDomain && (
              <Text fontSize="sm">
                This connection is set up for {note.connectionDomains.join(", ")}, so an address
                there is not accepted yet. What opens it is finishing the rest of this page: prove
                the domain, name someone who can still get in, and say who it lets in. All three,
                not just the domain.
              </Text>
            )}
          </VStack>
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

/**
 * The control that hands the browser to the identity provider. A failed
 * attempt is still the step to do, so the button stays solid: an outline
 * button after a failure reads as "this is finished, do it again if you like".
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
      data-testid="test-sign-in-start"
    >
      {failed || done ? <RefreshCw size={14} /> : <ExternalLink size={14} />}
      {testSignInLabel({ done, failed })}
    </Button>
  );
}

function testSignInLabel({ done, failed }: { done: boolean; failed: boolean }): string {
  if (failed) return "Try the sign-in again";

  return done ? "Test it again" : "Test sign-in";
}
