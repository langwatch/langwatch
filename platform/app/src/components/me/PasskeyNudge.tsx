import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Fingerprint } from "lucide-react";
import { useState } from "react";

import { Dialog } from "~/components/ui/dialog";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";
import { authClient } from "~/utils/auth-client";

/**
 * Offering a passkey to somebody who has just signed in without one
 * (ADR-120).
 *
 * It is a step rather than a banner, and that is the expensive choice made on
 * purpose: a banner in the shell costs nothing and converts accordingly, and
 * the population this exists for is people who do not know they want a
 * passkey and will therefore never go looking for one.
 *
 * Three properties keep it a nudge rather than a nag, and all three are load
 * bearing:
 *
 *   - it is asked ONCE and then not for thirty days, counted on the account
 *     so a new device does not restart it;
 *   - "Not now" costs nothing and is a real answer, sitting beside the offer
 *     rather than hidden as an X;
 *   - it comes AFTER the sign-in. Nobody is held out of the product to answer
 *     it, which is what separates an offer from a gate.
 *
 * Whether to ask at all is the server's decision (`user.passkeyNudge`), so
 * this component never has to know about deployment flags, held credentials
 * or intervals — it renders an answer.
 */
export function PasskeyNudge() {
  const nudge = api.user.passkeyNudge.useQuery({});
  const dismiss = api.user.dismissPasskeyNudge.useMutation();
  const apiContext = api.useUtils();
  const [isCreating, setIsCreating] = useState(false);
  // Closed locally the moment either button is pressed, rather than waiting
  // for the server to agree. The dialog is over — leaving it up while a
  // mutation settles reads as the click not having registered.
  const [isAnswered, setIsAnswered] = useState(false);

  if (isAnswered || nudge.data?.offer !== true) return null;

  const later = () => {
    setIsAnswered(true);
    dismiss.mutate({});
  };

  const create = async () => {
    setIsCreating(true);
    try {
      const result = await authClient.passkey.addPasskey({});
      if (result?.error) {
        // A prompt somebody opened and closed is a decision, not a failure —
        // and it is the same decision as "Not now", so it is recorded as one.
        // Otherwise the offer returns on the next page load, which reads as
        // the product not listening.
        if (result.error.status !== 0) {
          toaster.error({
            title: "That passkey wasn't created",
            description:
              "The attempt didn't finish. You can add one later from your account settings.",
          });
        }
        later();
        return;
      }
      toaster.success({ title: "Passkey created" });
      setIsAnswered(true);
      await apiContext.user.passkeyNudge.invalidate();
    } catch {
      toaster.error({
        title: "That passkey wasn't created",
        description: "This device could not complete the attempt.",
      });
      later();
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(details) => {
        if (!details.open) later();
      }}
      placement="center"
    >
      <Dialog.Content bg="bg" data-testid="passkey-nudge">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <HStack gap={2}>
            <Fingerprint size={18} />
            <Dialog.Title fontSize="md" fontWeight="500">
              Sign in faster next time
            </Dialog.Title>
          </HStack>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="start" gap={3}>
            {/* Said in terms of what somebody already does with their device.
                "Public key credential" is not a thing anybody has wanted. */}
            <Text fontSize="sm">
              Create a passkey and sign in with your fingerprint, face, or
              screen lock instead of typing a password.
            </Text>
            <Text fontSize="sm" color="fg.muted">
              It is saved in your credential manager, so you can use it on your
              other devices too.
            </Text>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <HStack gap={3} justify="end" width="full">
            <Button variant="outline" onClick={later} disabled={isCreating}>
              Not now
            </Button>
            <Button
              colorPalette="orange"
              loading={isCreating}
              onClick={() => void create()}
              data-testid="nudge-create-passkey"
            >
              Create a passkey
            </Button>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
