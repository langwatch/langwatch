/**
 * @see modules/auth/specs/auth-refusal-codes.feature
 */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { describe, expect, it } from "vitest";

import { answerAuthRefusalByRegisteredCode } from "../http.better-auth.channel.ts";

const BASE = "http://localhost:3000/api/auth";

function refusalHarness() {
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret",
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    emailAndPassword: { enabled: true },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        answerAuthRefusalByRegisteredCode(ctx);
      }),
    },
  });

  return async function post(path: string, body: unknown): Promise<Response> {
    return auth.handler(
      new Request(`${BASE}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify(body),
      }),
    );
  };
}

function answered({ path, refused }: { path: string; refused: APIError }): unknown {
  try {
    answerAuthRefusalByRegisteredCode({
      request: { url: `${BASE}${path}` },
      context: { returned: refused },
    });
    return refused;
  } catch (error) {
    return error;
  }
}

const HOLDER = { email: "holder@company.test", password: "correct-horse-battery", name: "Holder" };

describe("sign-in refusals", () => {
  /** @scenario "A wrong password on sign-in is refused as identity_sign_in_refused" */
  it("answers a wrong password under identity_sign_in_refused", async () => {
    const post = refusalHarness();
    await post("/sign-up/email", HOLDER);

    const response = await post("/sign-in/email", {
      email: HOLDER.email,
      password: "wrong-guess-1",
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "identity_sign_in_refused" });
  });

  /** @scenario "An address nobody holds is refused on sign-in exactly as a wrong password" */
  it("answers an unknown address under the same code and status", async () => {
    const post = refusalHarness();

    const response = await post("/sign-in/email", {
      email: "nobody@company.test",
      password: "wrong-guess-1",
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "identity_sign_in_refused" });
  });
});

describe("sign-up refusals", () => {
  /** @scenario "Signing up with an address already registered is refused as email_already_registered" */
  it("answers a taken address under email_already_registered", async () => {
    const post = refusalHarness();
    await post("/sign-up/email", HOLDER);

    const response = await post("/sign-up/email", HOLDER);

    expect(response.ok).toBe(false);
    expect(await response.json()).toMatchObject({ code: "email_already_registered" });
  });

  /** @scenario "Signing up with a password that is too short is refused as identity_password_rejected" */
  it("answers a too-short password under identity_password_rejected", async () => {
    const post = refusalHarness();

    const response = await post("/sign-up/email", { ...HOLDER, password: "short" });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "identity_password_rejected" });
  });
});

describe("password reset refusals", () => {
  /** @scenario "A password reset link that will not spend is refused as identity_reset_link_invalid" */
  it("answers an unissued token under identity_reset_link_invalid", async () => {
    const post = refusalHarness();

    const response = await post("/reset-password", {
      token: "never-issued",
      newPassword: "a-long-enough-password",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "identity_reset_link_invalid" });
  });
});

describe("answerAuthRefusalByRegisteredCode", () => {
  /** @scenario "An expired verification link is refused as identity_verification_expired" */
  it("re-answers an expired verification token at the status the endpoint chose", () => {
    const refused = APIError.from("UNAUTHORIZED", { code: "TOKEN_EXPIRED", message: "expired" });

    expect(answered({ path: "/verify-email?token=t", refused })).toMatchObject({
      status: "UNAUTHORIZED",
      body: { code: "identity_verification_expired" },
    });
  });

  /** @scenario "A passkey nobody holds is refused as identity_passkey_not_recognized" */
  it("re-answers an unknown passkey at the status the endpoint chose", () => {
    const refused = APIError.from("UNAUTHORIZED", { code: "PASSKEY_NOT_FOUND", message: "gone" });

    expect(answered({ path: "/passkey/verify-authentication", refused })).toMatchObject({
      status: "UNAUTHORIZED",
      body: { code: "identity_passkey_not_recognized" },
    });
  });

  /** @scenario "A passkey already on the account is refused as identity_passkey_already_registered" */
  it("re-answers a previously registered passkey", () => {
    const refused = APIError.from("BAD_REQUEST", {
      code: "PREVIOUSLY_REGISTERED",
      message: "already",
    });

    expect(answered({ path: "/passkey/verify-registration", refused })).toMatchObject({
      body: { code: "identity_passkey_already_registered" },
    });
  });

  /** @scenario "A refusal on an endpoint main left untranslated keeps better-auth's code" */
  it("leaves a refusal on the password reset request as it was", () => {
    const refused = APIError.from("BAD_REQUEST", { code: "INVALID_TOKEN", message: "no" });

    expect(answered({ path: "/request-password-reset", refused })).toBe(refused);
  });

  it("reads a code by the family it arrived on, not by the code alone", () => {
    const refused = APIError.from("BAD_REQUEST", { code: "INVALID_TOKEN", message: "no" });

    expect(answered({ path: "/verify-email?token=t", refused })).toMatchObject({
      body: { code: "identity_verification_invalid" },
    });
  });
});
