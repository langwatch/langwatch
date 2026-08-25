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
 *
 * THE FAILURE CARRIES ITS DETAIL. This is an administrator debugging their
 * own connection, not an end user signing in, so hiding the provider's words
 * behind "check the values" leaves them with nothing to check against. Both
 * failure surfaces — the request refused before redirecting, and the provider
 * bouncing the browser back with an error — hand the actual words over.
 */
export function useTestSignIn({ connectionId }: { connectionId: string }) {
  const [sending, setSending] = useState(false);
  // What the identity provider bounced the browser back with, read once off
  // the URL the callback returned us to (`error` / `error_description` are
  // the OAuth error shape better-auth passes through). State rather than a
  // render-time read so a client-side navigation clears it naturally.
  const [callbackFailure] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("error");
    if (!code) return null;
    const description = params.get("error_description");
    return description ? `${code}: ${description}` : code;
  });

  const start = async () => {
    setSending(true);
    try {
      const { error } = await authClient.signIn.sso({
        providerId: connectionId,
        // Back to this page, so the result is the first thing they see.
        callbackURL: window.location.href,
      });
      if (error) reportStartFailure(error);
    } catch (error) {
      reportRefusal(error);
    } finally {
      setSending(false);
    }
  };

  return { start, sending, callbackFailure };
}

/**
 * Not a handled payload: this comes back from the identity provider or from
 * the engine talking to it, so there is no code of ours to key copy off. The
 * one thing the administrator can act on is what was actually said, so it is
 * quoted rather than summarised away.
 */
function reportStartFailure(error: {
  code?: string | undefined;
  message?: string | undefined;
  statusText?: string;
  status?: number;
}): void {
  const detail = [
    error.code,
    error.message ?? error.statusText,
    error.status ? `(status ${error.status})` : null,
  ]
    .filter(Boolean)
    .join(" — ");
  toaster.create({
    title: "That sign-in didn't complete",
    description: detail
      ? `Your identity provider turned the request away. It said: ${detail}. Check the values you gave us against the application you created there, then try again.`
      : "Your identity provider turned the request away before saying anything. Check the issuer address you gave us, then try again.",
    type: "error",
    duration: 12000,
  });
}
