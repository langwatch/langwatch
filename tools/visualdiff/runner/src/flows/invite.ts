import type { Action } from "./context.ts";
import { argument } from "./context.ts";
import { clickText, declinePasskeyOffer, fillField, goTo } from "./primitives.ts";

/** JOINED_TIMEOUT_MILLIS bounds the wait for the invitee to leave the invite and sign-up
 * screens. */
const JOINED_TIMEOUT_MILLIS = 20_000;

/**
 * acceptInvite signs a new person up in a cookieless page, on the invited address, and joins
 * the organisation through the mailed invite link (`link`, from a `mail` step). The signed-in
 * page is untouched, so the flow goes on as the admin with a second member to manage.
 */
export const acceptInvite: Action = async (context) => {
  const code = new URL(argument({ context, name: "link" })).searchParams.get("inviteCode");
  if (code === null) throw new Error("the invite link carries no inviteCode");
  const guest = await context.side.openAnonymous();
  const as = { ...context, side: guest };
  try {
    const callback = encodeURIComponent(`/invite/accept?inviteCode=${encodeURIComponent(code)}`);
    await goTo({ context: as, path: `/auth/signup?callbackUrl=${callback}` });
    await fillField({ context: as, target: "name", value: argument({ context, name: "name" }) });
    await fillField({ context: as, target: "email", value: argument({ context, name: "email" }) });
    await fillField({ context: as, target: "password", value: context.credential.password });
    await fillField({ context: as, target: "confirmPassword", value: context.credential.password });
    await clickText({ context: as, text: "Sign up" });
    await declinePasskeyOffer({ page: guest.page, probeMillis: 2000 });
    // The branch words the button "Join <organisation>", main "Let me in".
    await clickText({ context: as, text: String.raw`/^\s*(Join .+|Let me in)\s*$/i` });
    await guest.page.waitForURL((url) => !/^\/(invite|auth)\//.test(url.pathname), {
      timeout: JOINED_TIMEOUT_MILLIS,
    });
  } finally {
    await guest.dispose();
  }
};
