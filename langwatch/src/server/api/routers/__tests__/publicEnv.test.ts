import { describe, expect, it, vi } from "vitest";

vi.mock("~/env.mjs", () => ({
  env: {
    BASE_HOST: "https://example.com",
    NEXTAUTH_PROVIDER: "auth0",
    DEMO_PROJECT_SLUG: undefined,
    NODE_ENV: "test",
    SENDGRID_API_KEY: undefined,
    USE_AWS_SES: undefined,
    AWS_REGION: undefined,
    IS_SAAS: false,
    SHOW_OPS_IN_MAIN_SIDEBAR: undefined,
    POSTHOG_KEY: undefined,
    POSTHOG_HOST: undefined,
    LANGWATCH_NLP_SERVICE: undefined,
    LANGWATCH_NLP_LAMBDA_CONFIG: undefined,
    LANGEVALS_ENDPOINT: undefined,
    STRIPE_LICENSE_PAYMENT_LINK_URL: undefined,
  },
}));

vi.mock("../../../sso/sso-gate", () => ({
  resolveAuthProvider: vi.fn(),
}));

import { resolveAuthProvider } from "../../../sso/sso-gate";
import { createInnerTRPCContext, createTRPCRouter } from "../../trpc";
import { publicEnvRouter } from "../publicEnv";

const testRouter = createTRPCRouter({ publicEnv: publicEnvRouter });

const callPublicEnv = () => {
  const ctx = createInnerTRPCContext({ session: null });
  return testRouter.createCaller(ctx).publicEnv({});
};

describe("publicEnvRouter", () => {
  describe("when the platform SSO gate allows", () => {
    it("reports the configured provider via resolveAuthProvider", async () => {
      vi.mocked(resolveAuthProvider).mockResolvedValue("auth0");

      const result = await callPublicEnv();

      expect(resolveAuthProvider).toHaveBeenCalled();
      expect(result.NEXTAUTH_PROVIDER).toBe("auth0");
    });
  });

  describe("when the platform SSO gate denies", () => {
    /** @scenario Self-hosted that never had a license hides SSO and offers email sign-in */
    it("reports email instead of the raw env var, so the sign-in page renders the email form", async () => {
      vi.mocked(resolveAuthProvider).mockResolvedValue("email");

      const result = await callPublicEnv();

      expect(result.NEXTAUTH_PROVIDER).toBe("email");
    });
  });
});
