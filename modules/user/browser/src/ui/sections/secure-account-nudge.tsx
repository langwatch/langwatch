/**
 * Offering to make an account harder to take over, once, after a password
 * sign-in: a step rather than a banner, "Not now" beside the offer, and never
 * a gate. Which halves to show is the server's answer. specs/identity/passkeys.feature
 */
import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { Fingerprint, ShieldCheck } from "lucide-react";

import { useSecureAccountNudge } from "../../behavior/use-secure-account-nudge.ts";

export default function SecureAccountNudge() {
  const nudge = useSecureAccountNudge();
  const offer = nudge.offer;

  // A session that recorded no method is not read as a password: the offer
  // comes back on the next sign-in rather than guessing.
  if (offer?.offer !== true || offer.signedInWith !== "password") return null;
  if (nudge.isAnswered) return null;

  return (
    <Dialog.Root
      open
      onOpenChange={(details) => {
        if (!details.open) void nudge.later();
      }}
      placement="center"
    >
      <Dialog.Content bg="bg" data-testid="secure-account-nudge">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <HStack gap={2}>
            {offer.passkey ? <Fingerprint size={18} /> : <ShieldCheck size={18} />}
            <Dialog.Title fontSize="md" fontWeight="500">
              {offer.passkey ? "Sign in faster next time" : "Secure your account"}
            </Dialog.Title>
          </HStack>
        </Dialog.Header>
        <Dialog.Body>
          <NudgeCopy offersPasskey={offer.passkey} offersTwoStep={offer.twoStep} />
        </Dialog.Body>
        <Dialog.Footer>
          <HStack gap={3} justify="end" width="full">
            <Button
              variant="outline"
              onClick={() => void nudge.later()}
              disabled={nudge.isCreating}
            >
              Not now
            </Button>
            {offer.twoStep && (
              <Button
                variant={offer.passkey ? "outline" : "solid"}
                colorPalette={offer.passkey ? undefined : "orange"}
                onClick={() => void nudge.setUpTwoStep()}
                disabled={nudge.isCreating}
                data-testid="nudge-set-up-two-step"
              >
                Set up two-step verification
              </Button>
            )}
            {offer.passkey && (
              <Button
                colorPalette="orange"
                loading={nudge.isCreating}
                onClick={() => void nudge.createPasskey()}
                data-testid="nudge-create-passkey"
              >
                Create a passkey
              </Button>
            )}
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** What the offer says, in terms of what somebody already does with their device. */
function NudgeCopy({
  offersPasskey,
  offersTwoStep,
}: {
  offersPasskey: boolean;
  offersTwoStep: boolean;
}) {
  return (
    <VStack align="start" gap={3}>
      {offersPasskey && (
        <>
          <Text fontSize="sm">
            Create a passkey and sign in with your fingerprint, face, or screen lock instead of
            typing a password.
          </Text>
          <Text fontSize="sm" color="fg.muted">
            It is saved in your credential manager, so you can use it on your other devices too.
          </Text>
        </>
      )}
      {offersTwoStep && (
        <Text fontSize="sm">
          {offersPasskey
            ? "You can also set up two-step verification, so signing in asks for a code from your authenticator as well as your password."
            : "Set up two-step verification, so signing in asks for a code from your authenticator as well as your password."}
        </Text>
      )}
    </VStack>
  );
}
