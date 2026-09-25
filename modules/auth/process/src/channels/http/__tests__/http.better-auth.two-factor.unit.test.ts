/**
 * @see modules/auth/specs/two-step-set-up.feature
 */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { APIError, createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { describe, expect, it } from "vitest";

import { answerAuthRefusalByRegisteredCode, twoFactorPlugin } from "../http.better-auth.channel.ts";

const BASE = "http://localhost:3000/api/auth";

function twoStepHarness() {
  const database: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    twoFactor: [],
  };
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret",
    database: memoryAdapter(database),
    emailAndPassword: { enabled: true },
    plugins: [
      twoFactorPlugin(),
      {
        id: "passwordless-account",
        endpoints: {
          mintPasswordless: createAuthEndpoint(
            "/test/passwordless-session",
            { method: "POST" },
            async (ctx) => {
              const user = await ctx.context.internalAdapter.createUser(
                {
                  email: "passkey-holder@company.test",
                  name: "Passkey Holder",
                  emailVerified: true,
                },
                { method: "passkey" },
              );
              const session = await ctx.context.internalAdapter.createSession(user.id);
              await setSessionCookie(ctx, { session, user });
              return ctx.json({ ok: true });
            },
          ),
        },
      },
    ],
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        answerAuthRefusalByRegisteredCode(ctx);
      }),
    },
  });

  async function post(path: string, body: unknown, cookie = ""): Promise<Response> {
    return auth.handler(
      new Request(`${BASE}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: "http://localhost:3000" },
        body: JSON.stringify(body),
      }),
    );
  }

  function cookieOf(response: Response): string {
    return response.headers
      .getSetCookie()
      .map((line) => line.split(";")[0])
      .join("; ");
  }

  return {
    async passwordlessSession(): Promise<string> {
      return cookieOf(await post("/test/passwordless-session", {}));
    },
    async passwordSession(): Promise<string> {
      return cookieOf(
        await post("/sign-up/email", {
          email: "password-holder@company.test",
          password: "correct-horse-battery",
          name: "Password Holder",
        }),
      );
    },
    post,
  };
}

describe("setting two-step verification up", () => {
  /** @scenario "An account with no password sets two-step verification up without one" */
  it("issues a LangWatch authenticator link without a password", async () => {
    const harness = twoStepHarness();
    const cookie = await harness.passwordlessSession();

    const response = await harness.post("/two-factor/enable", {}, cookie);

    expect(response.status).toBe(200);
    const answer: unknown = await response.json();
    expect(answer).toMatchObject({ totpURI: expect.stringContaining("issuer=LangWatch") });
  });

  /** @scenario "A wrong authenticator code is refused as identity_mfa_code_invalid" */
  it("answers a wrong code under identity_mfa_code_invalid", async () => {
    const harness = twoStepHarness();
    const cookie = await harness.passwordlessSession();
    await harness.post("/two-factor/enable", {}, cookie);

    const response = await harness.post("/two-factor/verify-totp", { code: "000000" }, cookie);

    expect(response.ok).toBe(false);
    expect(await response.json()).toMatchObject({ code: "identity_mfa_code_invalid" });
  });

  /** @scenario "A wrong password is refused as identity_mfa_password_invalid" */
  it("answers a wrong password under identity_mfa_password_invalid", async () => {
    const harness = twoStepHarness();
    const cookie = await harness.passwordSession();

    const response = await harness.post(
      "/two-factor/enable",
      { password: "not-it-at-all" },
      cookie,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "identity_mfa_password_invalid" });
  });
});

describe("answerAuthRefusalByRegisteredCode", () => {
  /** @scenario "Too many wrong codes is refused as identity_mfa_locked_out" */
  it("re-answers better-auth's lockout at the status the endpoint chose", () => {
    const refused = APIError.from("TOO_MANY_REQUESTS", {
      code: "ACCOUNT_TEMPORARILY_LOCKED",
      message: "Account temporarily locked",
    });
    const answer = (() => {
      try {
        answerAuthRefusalByRegisteredCode({
          request: { url: `${BASE}/two-factor/verify-totp` },
          context: { returned: refused },
        });
        return undefined;
      } catch (error) {
        return error;
      }
    })();

    expect(answer).toBeInstanceOf(APIError);
    expect(answer).toMatchObject({
      status: "TOO_MANY_REQUESTS",
      body: { code: "identity_mfa_locked_out" },
    });
  });

  it("leaves a refusal on another endpoint as it was", () => {
    const refused = APIError.from("BAD_REQUEST", {
      code: "INVALID_PASSWORD",
      message: "Invalid password",
    });

    expect(() =>
      answerAuthRefusalByRegisteredCode({
        request: { url: `${BASE}/change-password` },
        context: { returned: refused },
      }),
    ).not.toThrow();
  });
});
