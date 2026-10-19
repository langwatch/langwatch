import { Dialog } from "@langwatch/design-system/dialog";
/**
 * Offering to make an account harder to take over, once, after a password
 * sign-in: a step rather than a banner, "Not now" beside the offer, and never
 * a gate. Which halves to show is the server's answer. specs/identity/passkeys.feature
 */
import { Text, VStack } from "@langwatch/design-system/primitives";
import { Fingerprint, ShieldCheck } from "lucide-react";

import { useSecureAccountNudge } from "../../behavior/use-secure-account-nudge.ts";
import { SSO_HANDLES_SIGN_IN } from "../../model/last-way-in.ts";

export default function SecureAccountNudge() {
  const nudge = useSecureAccountNudge();
  const offer = nudge.offer;

  // A session that recorded no method is not read as a password: the offer
  // comes back on the next sign-in rather than guessing.
  if (offer?.offer !== true || offer.signedInWith !== "password") return null;
  if (nudge.isAnswered) return null;

  const setUpTwoStep = {
    label: "Set up two-step verification",
    onClick: () => void nudge.setUpTwoStep(),
    "data-testid": "nudge-set-up-two-step",
  };
  const createPasskey = {
    label: "Create a passkey",
    onClick: () => void nudge.createPasskey(),
    loading: nudge.isCreating,
    "data-testid": "nudge-create-passkey",
  };
  let primaryAction: typeof setUpTwoStep | typeof createPasskey | undefined;
  if (offer.passkey) primaryAction = createPasskey;
  else if (offer.twoStep) primaryAction = setUpTwoStep;

  return (
    <Dialog
      open
      onClose={() => void nudge.later()}
      placement="center"
      title={offer.passkey ? "Sign in faster next time" : "Secure your account"}
      icon={offer.passkey ? <Fingerprint size={18} /> : <ShieldCheck size={18} />}
      busy={nudge.isCreating}
      secondaryAction={{ label: "Not now", onClick: () => void nudge.later() }}
      secondaryActions={offer.passkey && offer.twoStep ? [setUpTwoStep] : void 0}
      primaryAction={primaryAction}
      cancelLabel={null}
      data-testid="secure-account-nudge"
    >
      <NudgeCopy offersPasskey={offer.passkey} offersTwoStep={offer.twoStep} />
      {nudge.ssoGoverned && (
        <Text fontSize="sm" color="fg.muted" marginTop={3} data-testid="nudge-sso-governed">
          {SSO_HANDLES_SIGN_IN}
        </Text>
      )}
    </Dialog>
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
