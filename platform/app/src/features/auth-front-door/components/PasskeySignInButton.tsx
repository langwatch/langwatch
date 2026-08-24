import { Button, Text, VStack } from "@chakra-ui/react";
import { Fingerprint } from "lucide-react";
import { useState } from "react";
import { HandledErrorAlert } from "~/features/errors";
import { authClient, navigate, safeRedirectTarget } from "~/utils/auth-client";
import { SHAPE } from "../logic/brand";
import { rememberLastUsedMethod } from "../logic/lastUsedMethod";

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
 * `rememberLastUsedMethod` is called on success rather than on the click. The
 * ceremony can be cancelled at the system prompt, and a badge that meant "last
 * dismissed" is the bug this screen already had once.
 */
export function PasskeySignInButton({ callbackUrl }: { callbackUrl?: string }) {
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
      <Button
        type="button"
        variant="outline"
        width="full"
        minHeight="44px"
        borderRadius={SHAPE.field}
        loading={isBusy}
        onClick={() => void dial()}
        data-testid="passkey-sign-in"
      >
        <Fingerprint size={16} />
        <Text>Use a passkey</Text>
      </Button>
    </VStack>
  );
}
