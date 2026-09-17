import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Fingerprint, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { Dialog } from "~/components/ui/dialog";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";
import { authClient } from "~/utils/auth-client";

/**
 * Offering to make an account harder to take over, to somebody who has just
 * signed in without either of the two things that would do it (ADR-120,
 * extended at D06).
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
 *     so a new device does not restart it — and ONE dismissal covers both
 *     halves, because two dialogs on the way in is a nag whatever each says;
 *   - "Not now" costs nothing and is a real answer, sitting beside the offer
 *     rather than hidden as an X;
 *   - it comes AFTER the sign-in. Nobody is held out of the product to answer
 *     it, which is what separates an offer from a gate.
 *
 * Which halves to show is the server's decision (`user.secureAccountNudge`),
 * so this component never has to know about deployment flags, held
 * credentials or intervals — it renders an answer.
 *
 * The one thing it decides is WHETHER TO ASK AT ALL, and it decides it on the
 * sign-in the server reports rather than on anything it holds itself. ADR-120
 * offers a passkey where a passkey REPLACES a password: somebody who came
 * through their employer's identity provider never typed one and cannot stop
 * typing one, and somebody who signed in with a passkey already has the thing
 * being offered. Both used to get the dialog anyway, because what the account
 * lacks is the same either way and nothing was reading how they got in.
 *
 * A session that recorded no method at all — every session minted before D06 —
 * is not read as a password. The offer comes back on their next sign-in, which
 * costs one deferral and never guesses.
 */
export function SecureAccountNudge() {
  const nudge = api.user.secureAccountNudge.useQuery({});

  if (nudge.data?.offer !== true) return null;
  if (nudge.data.signedInWith !== "password") return null;

  return (
    <SecureAccountNudgeOffer
      offersPasskey={nudge.data.passkey}
      offersTwoStep={nudge.data.twoStep}
    />
  );
}

function SecureAccountNudgeOffer({
  offersPasskey,
  offersTwoStep,
}: {
  offersPasskey: boolean;
  offersTwoStep: boolean;
}) {
  const answer = useNudgeAnswer();

  if (answer.isAnswered) return null;

  return (
    <Dialog.Root
      open
      onOpenChange={(details) => {
        if (!details.open) answer.later();
      }}
      placement="center"
    >
      <Dialog.Content bg="bg" data-testid="secure-account-nudge">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <HStack gap={2}>
            {offersPasskey ? (
              <Fingerprint size={18} />
            ) : (
              <ShieldCheck size={18} />
            )}
            <Dialog.Title fontSize="md" fontWeight="500">
              {offersPasskey
                ? "Sign in faster next time"
                : "Secure your account"}
            </Dialog.Title>
          </HStack>
        </Dialog.Header>
        <Dialog.Body>
          <NudgeCopy
            offersPasskey={offersPasskey}
            offersTwoStep={offersTwoStep}
          />
        </Dialog.Body>
        <Dialog.Footer>
          <NudgeActions
            offersPasskey={offersPasskey}
            offersTwoStep={offersTwoStep}
            isCreating={answer.isCreating}
            onLater={answer.later}
            onSetUpTwoStep={answer.setUpTwoStep}
            onCreatePasskey={answer.createPasskey}
          />
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * What the offer says, in terms of what somebody already does with their
 * device. "Public key credential" is not a thing anybody has wanted.
 */
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
            Create a passkey and sign in with your fingerprint, face, or screen
            lock instead of typing a password.
          </Text>
          <Text fontSize="sm" color="fg.muted">
            It is saved in your credential manager, so you can use it on your
            other devices too.
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

/**
 * The answers, with "Not now" first and never hidden as an X. Whichever half
 * the person lacks gets a button; when they lack both, the passkey is the
 * emphasized one, because it is the stronger credential and the faster
 * sign-in.
 */
function NudgeActions({
  offersPasskey,
  offersTwoStep,
  isCreating,
  onLater,
  onSetUpTwoStep,
  onCreatePasskey,
}: {
  offersPasskey: boolean;
  offersTwoStep: boolean;
  isCreating: boolean;
  onLater: () => void;
  onSetUpTwoStep: () => void;
  onCreatePasskey: () => void;
}) {
  return (
    <HStack gap={3} justify="end" width="full">
      <Button variant="outline" onClick={onLater} disabled={isCreating}>
        Not now
      </Button>
      {offersTwoStep && (
        <Button
          variant={offersPasskey ? "outline" : "solid"}
          colorPalette={offersPasskey ? undefined : "orange"}
          onClick={onSetUpTwoStep}
          disabled={isCreating}
          data-testid="nudge-set-up-two-step"
        >
          Set up two-step verification
        </Button>
      )}
      {offersPasskey && (
        <Button
          colorPalette="orange"
          loading={isCreating}
          onClick={onCreatePasskey}
          data-testid="nudge-create-passkey"
        >
          Create a passkey
        </Button>
      )}
    </HStack>
  );
}

/**
 * What each answer does. State and callbacks, no JSX: the dialog above
 * renders them.
 *
 * Every path closes the dialog LOCALLY the moment a button is pressed rather
 * than waiting for the server to agree. The dialog is over — leaving it up
 * while a mutation settles reads as the click not having registered.
 */
function useNudgeAnswer() {
  const dismiss = api.user.dismissSecureAccountNudge.useMutation();
  const apiContext = api.useUtils();
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState(false);
  const [isAnswered, setIsAnswered] = useState(false);

  const later = () => {
    setIsAnswered(true);
    dismiss.mutate({});
  };

  const setUpTwoStep = () => {
    // Dismissed on the way, not on arrival: somebody who came here to set one
    // up has answered the question, and finding the dialog again behind the
    // settings page would read as the product not listening.
    later();
    void navigate("/settings/security");
  };

  const createPasskey = () => {
    void runPasskeyRegistration({
      onCancelled: later,
      onCreated: async () => {
        setIsAnswered(true);
        await apiContext.user.secureAccountNudge.invalidate();
      },
      setIsCreating,
    });
  };

  return { isAnswered, isCreating, later, setUpTwoStep, createPasskey };
}

/**
 * The registration ceremony, and what each of its endings means.
 *
 * A prompt somebody opened and closed is a DECISION, not a failure — and it
 * is the same decision as "Not now", so it is recorded as one. Otherwise the
 * offer returns on the next page load, which reads as the product not
 * listening.
 */
async function runPasskeyRegistration({
  onCancelled,
  onCreated,
  setIsCreating,
}: {
  onCancelled: () => void;
  onCreated: () => Promise<void>;
  setIsCreating: (creating: boolean) => void;
}): Promise<void> {
  setIsCreating(true);
  try {
    const result = await authClient.passkey.addPasskey({});
    if (result?.error) {
      // Status 0 is the person closing the system prompt. Anything else went
      // wrong and is worth saying so.
      if (result.error.status !== 0) {
        toaster.error({
          title: "That passkey wasn't created",
          description:
            "The attempt didn't finish. You can add one later from your account settings.",
        });
      }
      onCancelled();
      return;
    }
    toaster.success({ title: "Passkey created" });
    await onCreated();
  } catch {
    toaster.error({
      title: "That passkey wasn't created",
      description: "This device could not complete the attempt.",
    });
    onCancelled();
  } finally {
    setIsCreating(false);
  }
}
