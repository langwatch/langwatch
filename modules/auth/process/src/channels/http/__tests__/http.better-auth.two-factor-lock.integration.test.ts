/**
 * The product's two-step plugin inside a real Better Auth handler: once wrong codes have locked
 * the account, a backup code is refused like any other code and is not spent by the attempt.
 * @see specs/identity/mfa-and-session-shape.feature
 */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { symmetricDecrypt } from "better-auth/crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { twoFactorPlugin } from "../http.better-auth.channel.ts";

const baseURL = "http://localhost:3000";
const email = "sam@home.test";
const password = "test-password-1";
const secret = "test-secret-test-secret-test-secret";
const WRONG_CODE = "000000";
const ATTEMPTS_PER_CHALLENGE = 5;
const identitySchema = z.object({ user: z.object({ id: z.string() }) });
const enrollmentSchema = z.object({ backupCodes: z.array(z.string()) });
const factorRowSchema = z.object({
  userId: z.string(),
  secret: z.string(),
  backupCodes: z.string(),
  lockedUntil: z.coerce.date().nullish(),
});

function post(path: string, body: Record<string, unknown>, cookie?: string): Request {
  return new Request(`${baseURL}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** An enrolled person ("sam") with a live Better Auth handler over an in-memory store. */
async function enrolledPerson() {
  const db: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    twoFactor: [],
  };
  const auth = betterAuth({
    baseURL,
    secret,
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    plugins: [twoFactorPlugin()],
  });
  const signup = await auth.handler(post("/sign-up/email", { email, password, name: "Sam" }));
  if (signup.status !== 200) throw new Error(`sign-up failed: ${await signup.text()}`);
  const userId = identitySchema.parse(await signup.json()).user.id;
  const enable = await auth.handler(post("/two-factor/enable", { password }, cookiesOf(signup)));
  if (enable.status !== 200) throw new Error(`enrolment failed: ${await enable.text()}`);
  const { backupCodes } = enrollmentSchema.parse(await enable.json());
  const factorRow = () => factorRowSchema.parse(db.twoFactor?.find((row) => row.userId === userId));
  const totpSecret = await symmetricDecrypt({ key: secret, data: factorRow().secret });
  const { code } = await auth.api.generateTOTP({ body: { secret: totpSecret } });
  const verified = await auth.handler(post("/two-factor/verify-totp", { code }, cookiesOf(signup)));
  if (verified.status !== 200) throw new Error("enrolment verification failed");
  db.session = [];

  /** Password sign-in stops at the second step and hands back the pending-challenge cookie. */
  const pendingSecondStep = async (): Promise<string> => {
    const first = await auth.handler(post("/sign-in/email", { email, password }));
    expect(await first.json()).toMatchObject({ twoFactorRedirect: true });
    return cookiesOf(first);
  };
  const enter = ({ path, code, cookie }: { path: string; code: string; cookie: string }) =>
    auth.handler(post(path, { code }, cookie));

  return { db, backupCodes, factorRow, pendingSecondStep, enter };
}

describe("backup codes once wrong codes have locked the account", () => {
  /** @scenario "Backup codes are locked out with everything else" */
  it("refuses a valid backup code, spends none and leaves the wait as it was", async () => {
    const person = await enrolledPerson();
    let lock = person.factorRow().lockedUntil;
    for (let challenge = 0; challenge < 4 && !lock; challenge += 1) {
      const pending = await person.pendingSecondStep();
      for (let attempt = 0; attempt < ATTEMPTS_PER_CHALLENGE && !lock; attempt += 1) {
        await person.enter({ path: "/two-factor/verify-totp", code: WRONG_CODE, cookie: pending });
        lock = person.factorRow().lockedUntil;
      }
    }
    expect(lock).toBeTruthy();
    const before = person.factorRow();

    const refused = await person.enter({
      path: "/two-factor/verify-backup-code",
      code: person.backupCodes[0] ?? "",
      cookie: await person.pendingSecondStep(),
    });

    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "ACCOUNT_TEMPORARILY_LOCKED" });
    expect(person.db.session).toEqual([]);
    expect(person.factorRow().backupCodes).toBe(before.backupCodes);
    expect(person.factorRow().lockedUntil).toEqual(before.lockedUntil);

    const row = person.db.twoFactor?.[0];
    if (!row) throw new Error("no two-step row");
    row.lockedUntil = new Date(Date.now() - 1_000);
    const afterWait = await person.enter({
      path: "/two-factor/verify-backup-code",
      code: person.backupCodes[0] ?? "",
      cookie: await person.pendingSecondStep(),
    });

    expect(afterWait.status).toBe(200);
    expect(person.db.session).toHaveLength(1);
  }, 30_000);
});
