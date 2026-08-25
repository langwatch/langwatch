import { useState } from "react";
import { reportRefusal } from "~/components/settings/singleSignOn/refusals";
import { toaster } from "~/components/ui/toaster";
import { authClient } from "~/utils/auth-client";

/**
 * Sending yourself to the identity provider and back, from anywhere that
 * offers it.
 *
 * The sign-in NAMES THE CONNECTION rather than going through the auth screens,
 * and that is what makes it possible before the organization's sign-in has
 * been switched over: proving the connection has to be something an
 * administrator can do while nothing about anybody else's sign-in has changed.
 *
 * A hook rather than a component, because two surfaces offer the same act with
 * different chrome around it — a step in the setup journey, and a control on
 * the overview — and the one thing that must not differ between them is what
 * pressing it does.
 */
export function useTestSignIn({ connectionId }: { connectionId: string }) {
  const [sending, setSending] = useState(false);

  const start = async () => {
    setSending(true);
    try {
      const { error } = await authClient.signIn.sso({
        providerId: connectionId,
        // Back to this page, so the result is the first thing they see.
        callbackURL: window.location.href,
      });
      if (error) {
        // Not a handled payload: this comes back from the identity provider
        // or from the engine talking to it, so there is no code of ours to
        // key copy off. What the reader can act on is checking the values
        // they gave us against the application they created.
        toaster.create({
          title: "That sign-in didn't complete",
          description:
            "Your identity provider turned the request away. Check the values you gave us against the application you created there, then try again.",
          type: "error",
          duration: 8000,
        });
      }
    } catch (error) {
      reportRefusal(error);
    } finally {
      setSending(false);
    }
  };

  return { start, sending };
}
