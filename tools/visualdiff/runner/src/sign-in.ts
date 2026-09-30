import { join } from "node:path";

import { captureMessage, type Side } from "./capture.ts";
import { signIn } from "./flows/actions.ts";
import { declinePasskeyOffer, passkeyOffer } from "./flows/primitives.ts";
import { SIGN_IN_FLOW } from "./pairing.ts";
import type { Plan } from "./protocol.ts";
import type { Collect } from "./screens.ts";

/** The offer only mounts once the app shell has left its splash, which r14 showed takes over 2s. */
const PASSKEY_SIGN_IN_PROBE_MILLIS = 20_000;

/**
 * capturePasskeyOffer is the one screen that keeps the passkey offer: a password
 * sign-in must be offered one, so its absence is an error, then it is declined.
 */
const capturePasskeyOffer = async ({
  plan,
  side,
  collect,
}: {
  plan: Plan;
  side: Side;
  collect: Collect;
}): Promise<void> => {
  const startedAt = Date.now();
  const file = join(plan.outDir, side.name, "flows", SIGN_IN_FLOW, "0000.png");
  const shown = await passkeyOffer(side.page)
    .waitFor({ state: "visible", timeout: PASSKEY_SIGN_IN_PROBE_MILLIS })
    .then(() => true)
    .catch(() => false);
  await side.screenshot(file).catch(() => undefined);
  collect(
    captureMessage({
      kind: "flow",
      key: SIGN_IN_FLOW,
      index: 0,
      label: "signIn: passkey offer",
      side,
      screenshot: file,
      error: shown ? "" : "no passkey offer after a password sign-in",
      durationMs: Date.now() - startedAt,
      notFound: false,
      blank: await side.blank(),
      ariaSnapshot: await side.ariaSnapshot(),
    }),
  );
  if (shown) await declinePasskeyOffer({ page: side.page, probeMillis: 0 });
};

/** signInSide signs in before any route, so routes photograph the product, not the sign-in page. */
export const signInSide = async ({
  plan,
  side,
  collect,
}: {
  plan: Plan;
  side: Side;
  collect: Collect;
}): Promise<void> => {
  if (plan.credential.email === "") return;
  const emails = [plan.credential.email, ...(plan.credential.fallbackEmails ?? [])];
  const failures: string[] = [];
  for (const email of emails) {
    const failure = await signIn({
      side,
      slug: plan.slug,
      credential: { ...plan.credential, email },
      args: {},
      values: {},
      snapshot: async () => undefined,
    }).then(
      () => "",
      (thrown: unknown) => (thrown instanceof Error ? thrown.message : String(thrown)),
    );
    await side.waitUntilQuiet();
    if (failure === "" && !new URL(side.page.url()).pathname.startsWith("/auth/")) {
      side.drain();
      await capturePasskeyOffer({ plan, side, collect });
      side.drain();
      return;
    }
    failures.push(`${email}: ${failure === "" ? "still on an /auth/ page" : failure}`);
  }
  const page = (await side.ariaSnapshot())
    .replaceAll(/(textbox "[^"]*"): .*/g, "$1: <typed>")
    .replaceAll("\n", " | ")
    .slice(0, 1500);
  throw new Error(
    `${side.name} could not sign in (${failures.join("; ")}) at ${side.page.url()}; page: ${page}`,
  );
};
