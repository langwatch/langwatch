import { Box, Card, Heading, Text, VStack } from "@chakra-ui/react";
import { ShieldCheck } from "lucide-react";
import { TwoFactorSetupFlow } from "~/components/me/twoFactor/TwoFactorSetupFlow";
import { explainHandledError, type HandledErrorShape } from "~/features/errors";

/**
 * The enrollment gate: an organization that requires a second factor, and
 * somebody who cannot yet prove one.
 *
 * It is a gate, not a sign-out and not a challenge. Everything the words do
 * here follows from that, and it is the difference between a screen people
 * act on and one they read as a fault:
 *
 *   - it NAMES the organization asking, because the person is still signed in
 *     to everything else and needs to know which door this is;
 *   - it offers the setup on the spot rather than sending anyone to settings,
 *     because finishing it here opens this same session;
 *   - it says nothing about signing in again, because nothing about their
 *     session is wrong.
 *
 * The copy for the refusal itself comes from the code-keyed registry, the
 * same words a toast or an inline alert would show for
 * `identity_mfa_enrollment_required`. One code, one set of words, wherever it
 * surfaces.
 */
/**
 * The refusal this screen IS, in the shape the registry reads.
 *
 * Not an error caught from anywhere — the gate renders before any request is
 * refused — but the same code, so the words are the ones a toast or an inline
 * alert would show for it. One code, one set of words.
 */
const HELD_AT_THE_GATE: HandledErrorShape = {
  code: "identity_mfa_enrollment_required",
  meta: {},
  httpStatus: 403,
  fault: "customer",
  tips: [],
  docsUrl: undefined,
  traceId: undefined,
  reasons: [],
};

export function OrganizationMfaGate({
  organizationName,
  offerPasskey,
  onEnrolled,
}: {
  organizationName: string;
  offerPasskey: boolean;
  onEnrolled: () => void;
}) {
  // Read through the registry rather than written here, so the gate and every
  // other surface for this code cannot drift apart.
  const copy = explainHandledError(HELD_AT_THE_GATE);

  return (
    <Box
      width="full"
      display="flex"
      justifyContent="center"
      paddingY={10}
      paddingX={4}
      data-testid="organization-mfa-gate"
    >
      <VStack align="stretch" gap={6} maxWidth="560px" width="full">
        <VStack align="start" gap={2}>
          <Box color="fg.muted">
            <ShieldCheck size={28} />
          </Box>
          <Heading as="h1" size="lg">
            {organizationName} requires two-step verification
          </Heading>
          <Text color="fg.muted">{copy.description}</Text>
          {offerPasskey ? (
            <Text color="fg.muted" data-testid="organization-mfa-gate-passkey">
              You can also sign in again with your passkey, which counts as your
              second factor.
            </Text>
          ) : null}
        </VStack>

        <Card.Root width="full">
          <Card.Body>
            <TwoFactorSetupFlow
              onFinished={onEnrolled}
              onCancel={() => {
                // Nothing to cancel back to: this screen is what the person
                // is looking at, and a cancel would leave them on it.
                // Finishing is the way through, and every other organization
                // is one click away in the switcher above.
              }}
            />
          </Card.Body>
        </Card.Root>
      </VStack>
    </Box>
  );
}
