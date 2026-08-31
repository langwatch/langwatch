import { describe, expect, it, vi } from "vitest";

// Only the three facts this surface reports are pinned; everything else keeps
// the real value, because the whole router graph boots behind `appRouter`.
vi.mock("~/env.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/env.mjs")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      NEXTAUTH_PROVIDER: "auth0",
      SHOW_OPS_IN_MAIN_SIDEBAR: undefined,
    },
  };
});

vi.mock("~/runtime/app/features/sso", () => ({
  resolveAuthProvider: vi.fn(),
  platformSSOAllowed: vi.fn(async () => false),
  buildSocialProviders: vi.fn(() => ({})),
  buildGenericOAuthConfigs: vi.fn(() => []),
  ssoConfiguration: {
    isSaas: false,
    provider: "email",
    baseUrl: "https://example.com",
  },
}));

import { resolveAuthProvider } from "~/runtime/app/features/sso";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

const callPublicEnv = () => {
  const ctx = createInnerTRPCContext({
    session: null,
    // `permissions` is here because the base policy chain runs the
    // scope-lineage guard ahead of every procedure, signed-out ones included.
    app: {
      config: { opsSidebarEmails: [] },
      permissions: {
        checkScopeLineage: vi.fn().mockResolvedValue({ kind: "consistent" }),
      },
    } as unknown as Parameters<typeof createInnerTRPCContext>[0]["app"],
  });
  return appRouter.createCaller(ctx).publicEnv({});
};

describe("the publicEnv procedure", () => {
  describe("when the platform SSO gate allows", () => {
    it("reports the configured provider via resolveAuthProvider", async () => {
      vi.mocked(resolveAuthProvider).mockResolvedValue("auth0");

      const result = await callPublicEnv();

      expect(resolveAuthProvider).toHaveBeenCalled();
      expect(result).toEqual({
        NEXTAUTH_PROVIDER: "auth0",
        SHOW_OPS_IN_MAIN_SIDEBAR: false,
      });
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
