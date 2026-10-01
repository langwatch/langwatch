import type { Page } from "playwright";

import type { Action, ActionContext } from "./context.ts";
import { argument } from "./context.ts";
import { readField } from "./expect.ts";
import { summaries } from "./mail.ts";
import { clickText, declinePasskeyOffer, fillField, goTo } from "./primitives.ts";

/** JOINED_TIMEOUT_MILLIS bounds the wait for the invitee to leave the invite and sign-up
 * screens. */
const JOINED_TIMEOUT_MILLIS = 20_000;

/** LINK_TIMEOUT_MILLIS bounds the wait for the sign-up address-confirmation mail. */
const LINK_TIMEOUT_MILLIS = 20_000;

/** FORM_PROBE_MILLIS bounds the wait for the sign-up page to draw its first field. */
const FORM_PROBE_MILLIS = 15_000;

/** hasNameField is main's single-page sign-up (name, email, password); the branch asks for the
 * address first and never for a name. */
const hasNameField = async (page: Page): Promise<boolean> => {
  await page
    .locator("input")
    .locator("visible=true")
    .first()
    .waitFor({ timeout: FORM_PROBE_MILLIS })
    .catch(() => undefined);
  return (
    (await page
      .locator('input[name="name"]')
      .count()
      .catch(() => 0)) > 0
  );
};

/** passwordShown: the branch's sign-up password step; a signing-in link skips it. */
const passwordShown = async (page: Page): Promise<boolean> =>
  page
    .locator('input[type="password"]')
    .first()
    .waitFor({ timeout: FORM_PROBE_MILLIS })
    .then(
      () => true,
      () => false,
    );

/** verifyLink waits for the mailed sign-up link (`?verify=`) among everything `to` was sent. */
const verifyLink = async ({
  context,
  to,
}: {
  context: ActionContext;
  to: string;
}): Promise<string> => {
  const { mailUrl } = context;
  if (mailUrl === undefined) throw new Error("this side has no mail sink (services/mailsim)");
  const { request } = context.side.page;
  const options = { ignoreHTTPSErrors: true, failOnStatusCode: false };
  const deadline = Date.now() + LINK_TIMEOUT_MILLIS;
  for (;;) {
    const listed = await request.get(
      `${mailUrl}/api/messages?${new URLSearchParams({ to })}`,
      options,
    );
    const found = listed.ok() ? summaries(await listed.json().catch(() => undefined)) : [];
    for (const { id } of found) {
      const message = await request.get(`${mailUrl}/api/messages/${id}`, options);
      const links = readField({ body: await message.json().catch(() => undefined), path: "links" });
      const link = Array.isArray(links)
        ? links.find(
            (item: unknown): item is string => typeof item === "string" && item.includes("verify="),
          )
        : undefined;
      if (link !== undefined) return link;
    }
    if (Date.now() > deadline) throw new Error(`no sign-up link mailed to ${to}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

/**
 * acceptInvite signs a new person up in a cookieless page and joins through the mailed invite
 * `link`; the admin page is untouched. Main signs up on one page, the branch confirms the
 * address by a mailed link first.
 */
export const acceptInvite: Action = async (context) => {
  const code = new URL(argument({ context, name: "link" })).searchParams.get("inviteCode");
  if (code === null) throw new Error("the invite link carries no inviteCode");
  const accept = `/invite/accept?inviteCode=${encodeURIComponent(code)}`;
  const email = argument({ context, name: "email" });
  const guest = await context.side.openAnonymous();
  const as = { ...context, side: guest };
  try {
    await goTo({ context: as, path: `/auth/signup?callbackUrl=${encodeURIComponent(accept)}` });
    const singlePage = await hasNameField(guest.page);
    if (singlePage) {
      await fillField({ context: as, target: "name", value: argument({ context, name: "name" }) });
    }
    await fillField({ context: as, target: "email", value: email });
    if (!singlePage) {
      await clickText({ context: as, text: String.raw`/^\s*Continue\s*$/` });
      await goTo({ context: as, path: await verifyLink({ context: as, to: email }) });
    }
    const passwordStep = singlePage || (await passwordShown(guest.page));
    if (passwordStep) {
      await fillField({ context: as, target: "password", value: context.credential.password });
      await fillField({
        context: as,
        target: "confirmPassword",
        value: context.credential.password,
      });
      await clickText({ context: as, text: String.raw`/^\s*(Sign up|Create account)\s*$/i` });
      await declinePasskeyOffer({ page: guest.page, probeMillis: 2000 });
    }
    if (!singlePage) {
      await guest.page.waitForURL((url) => !url.pathname.startsWith("/auth/signup"), {
        timeout: JOINED_TIMEOUT_MILLIS,
      });
      await goTo({ context: as, path: accept });
    }
    // The branch words the button "Join <organisation>", main "Let me in".
    await clickText({ context: as, text: String.raw`/^\s*(Join .+|Let me in)\s*$/i` });
    await guest.page.waitForURL((url) => !/^\/(invite|auth)\//.test(url.pathname), {
      timeout: JOINED_TIMEOUT_MILLIS,
    });
  } finally {
    await guest.dispose();
  }
};
