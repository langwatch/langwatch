import { join } from "node:path";

import { captureMessage, type Side } from "./capture.ts";
import { signIn } from "./flows/actions.ts";
import { declinePasskeyOffer, passkeyOffer } from "./flows/primitives.ts";
import { SIGN_IN_FLOW } from "./pairing.ts";
import type { Plan } from "./protocol.ts";
import type { Collect } from "./screens.ts";

/** The offer only mounts once the app shell has left its splash, which r14 showed takes over 2s. */
const PASSKEY_SIGN_IN_PROBE_MILLIS = 20_000;

/** offerAbsent names the precondition the capture needs, so a red step says what to restore. */
const offerAbsent = ({ email, failure }: { email: string; failure: string }): string =>
  `no passkey offer after a password sign-in as ${email}: the account answered it within 30 days, ` +
  `or passkeys are off${failure === "" ? "" : `; the sign-in itself failed (${failure})`}`;

/** signInAs tries each address in turn and returns the one that signed in, with what failed. */
const signInAs = async ({
  plan,
  side,
  emails,
}: {
  plan: Plan;
  side: Side;
  emails: string[];
}): Promise<{ email: string | undefined; failures: string[] }> => {
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
      return { email, failures };
    }
    failures.push(`${email}: ${failure === "" ? "still on an /auth/ page" : failure}`);
  }
  return { email: undefined, failures };
};

/**
 * captureOffer photographs the passkey offer a password sign-in shows. Its absence is an error
 * naming the precondition only when `required`: the probe account is never answered, but a
 * fallback account may have declined it already (an answer lasts 30 days).
 */
const captureOffer = async ({
  plan,
  side,
  email,
  failure,
  required,
  collect,
}: {
  plan: Plan;
  side: Side;
  email: string;
  failure: string;
  required: boolean;
  collect: Collect;
}): Promise<boolean> => {
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
      error: shown || !required ? "" : offerAbsent({ email, failure }),
      durationMs: Date.now() - startedAt,
      notFound: false,
      blank: await side.blank(),
      ariaSnapshot: await side.ariaSnapshot(),
    }),
  );
  return shown;
};

/**
 * capturePasskeyOffer photographs the offer in a context of its own as the probe account,
 * which nothing else signs in as and which is never answered, so every run sees it
 * outstanding. Without a probe it uses the run's own account and answers it.
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
  const probeEmail = plan.credential.probeEmail ?? "";
  if (probeEmail === "") {
    const shown = await captureOffer({
      plan,
      side,
      email: plan.credential.email,
      failure: "",
      required: true,
      collect,
    });
    if (shown) await declinePasskeyOffer({ page: side.page, probeMillis: 0 });
    return;
  }
  const probe = await side.openAnonymous();
  try {
    const emails = [probeEmail, plan.credential.email, ...(plan.credential.fallbackEmails ?? [])];
    const { email, failures } = await signInAs({ plan, side: probe, emails });
    probe.drain();
    await captureOffer({
      plan,
      side: probe,
      email: email ?? probeEmail,
      failure: email === undefined ? failures.join("; ") : "",
      required: email === undefined || email === probeEmail,
      collect,
    });
    probe.drain();
  } finally {
    await probe.dispose();
  }
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
  const { email, failures } = await signInAs({ plan, side, emails });
  if (email !== undefined) {
    side.drain();
    await capturePasskeyOffer({ plan, side, collect });
    side.drain();
    return;
  }
  const page = (await side.ariaSnapshot())
    .replaceAll(/(textbox "[^"]*"): .*/g, "$1: <typed>")
    .replaceAll("\n", " | ")
    .slice(0, 1500);
  throw new Error(
    `${side.name} could not sign in (${failures.join("; ")}) at ${side.page.url()}; page: ${page}`,
  );
};
