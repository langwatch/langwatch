import { VStack } from "@chakra-ui/react";
import type { SignInMethod } from "@langwatch/identity";
import type { ReactNode } from "react";
import { useState } from "react";
import { HandledErrorAlert } from "~/features/errors";
import { authClient, navigate, safeRedirectTarget } from "~/utils/auth-client";
import { rememberLastUsedMethod } from "../logic/lastUsedMethod";
import { signInMethodActionLabel } from "../logic/methodLabels";
import { MethodButton } from "./MethodButton";
import { SignInMethodIcon } from "./SignInMethodIcon";

/** The client's name for the ceremony, so the mark and the words are drawn by
 *  the same two functions every other method on the rail is drawn by. */
const PASSKEY: SignInMethod = {
  id: "passkey",
  kind: "passkey",
  connectionId: null,
};

/**
 * Signing in with a passkey: the whole ceremony is the browser's, so this is
 * one button and the platform does the rest.
 *
 * No address is asked for and none is sent. A passkey names the account by
 * itself — that is what makes it a way IN rather than a second factor — so the
 * router deliberately learns nothing from this path, and neither does anybody
 * watching it: a discoverable credential prompt looks the same whether or not
 * this browser holds one for us.
 *
 * It wears the same seat as every provider beside it (`MethodButton`) and is
 * named the way they are — "Continue with a passkey", off the same
 * `signInMethodActionLabel` that writes "Continue with Google". A method that
 * announced itself differently would read as a different kind of offer, and it
 * is not one: it is the same door, opened by something already on the device.
 *
 * `rememberLastUsedMethod` is called on success rather than on the click. The
 * ceremony can be cancelled at the system prompt, and a badge that meant "last
 * dismissed" is the bug this screen already had once.
 */
export function PasskeySignInButton({
  callbackUrl,
  badge,
}: {
  callbackUrl?: string;
  /** "Last used", where this browser remembers getting in this way. */
  badge?: ReactNode;
}) {
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const dial = async () => {
    setError(null);
    setIsBusy(true);
    try {
      const result = await authClient.signIn.passkey();
      // A cancelled prompt is not a failure worth shouting about: the person
      // closed it, and the other methods are still on the screen behind this.
      if (result?.error) {
        if (result.error.status !== 0) setError(result.error);
        return;
      }
      rememberLastUsedMethod({ id: "passkey" });
      navigate(safeRedirectTarget(callbackUrl));
    } catch (caught) {
      setError(caught);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <VStack width="full" align="stretch" gap="10px">
      <HandledErrorAlert
        error={error}
        fallbackTitle="Could not use a passkey"
        className="lw-front-door-alert"
      />
      <MethodButton
        icon={<SignInMethodIcon method={PASSKEY} />}
        label={signInMethodActionLabel(PASSKEY)}
        badge={badge}
        isBusy={isBusy}
        onClick={() => void dial()}
        testId="passkey-sign-in"
      />
    </VStack>
  );
}
