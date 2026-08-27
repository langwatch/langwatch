import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/runtime/app/features/sso", () => ({
  resolveAuthProvider: vi.fn(),
}));

const { routeMock } = vi.hoisted(() => ({ routeMock: vi.fn() }));
vi.mock("~/server/app-layer/identity/runtime", () => ({
  signInRouter: () => ({ route: routeMock }),
}));

vi.mock("~/env.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/env.mjs")>();
  return {
    ...actual,
    env: { ...actual.env, IDENTITY_ROUTER_V2: "off" },
  };
});

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("@langwatch/observability", () => ({ createLogger: () => loggerMock }));

import { resolveAuthProvider } from "~/runtime/app/features/sso";
import type { RoutingDecision, SignInMethod } from "@langwatch/identity";
import { env } from "~/env.mjs";
import { runSignInRouterShadow } from "../signInRouterShadow";

const envMock = env as unknown as { IDENTITY_ROUTER_V2: string };

const PASSWORD: SignInMethod = {
  id: "password",
  kind: "password",
  connectionId: null,
};
const OKTA: SignInMethod = {
  id: "okta",
  kind: "federated",
  connectionId: "org_acme",
};

const picker: RoutingDecision = {
  outcome: "method_picker",
  methodSet: [PASSWORD],
  reasonCode: "no_domain_match",
};

const redirect: RoutingDecision = {
  outcome: "redirect_to_connection",
  connectionId: "org_acme",
  methodSet: [OKTA],
  reasonCode: "domain_routed",
};

const run = ({
  path = "/api/auth/sign-in/email",
  body = { email: "sam@home.net" },
}: {
  path?: string;
  body?: unknown;
} = {}) =>
  runSignInRouterShadow({
    pathname: path,
    url: `https://host${path}`,
    body,
  });

describe("the identity router's shadow comparison", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMock.IDENTITY_ROUTER_V2 = "shadow";
    routeMock.mockResolvedValue(picker);
    vi.mocked(resolveAuthProvider).mockResolvedValue("email");
  });

  describe("given the flag is off", () => {
    beforeEach(() => {
      envMock.IDENTITY_ROUTER_V2 = "off";
    });

    /** @scenario "The flag off restores the legacy path entirely" */
    it("computes nothing, reads nothing and logs nothing", async () => {
      await expect(run()).resolves.toEqual({ ran: false });

      expect(routeMock).not.toHaveBeenCalled();
      expect(resolveAuthProvider).not.toHaveBeenCalled();
      expect(loggerMock.warn).not.toHaveBeenCalled();
    });

    /** @scenario "The flag off restores the legacy path entirely" */
    it("stays inert after the flag has been enforced and turned back off", async () => {
      envMock.IDENTITY_ROUTER_V2 = "enforce";
      await run();
      expect(routeMock).not.toHaveBeenCalled();

      envMock.IDENTITY_ROUTER_V2 = "off";
      await expect(run()).resolves.toEqual({ ran: false });
      expect(routeMock).not.toHaveBeenCalled();
    });
  });

  describe("given the flag is in shadow", () => {
    /** @scenario "Shadow mode compares every login and changes nothing" */
    it("computes the router's decision and compares it against the legacy outcome", async () => {
      const result = await run();

      expect(routeMock).toHaveBeenCalledWith({
        identifier: "sam@home.net",
        breakGlass: false,
      });
      expect(result).toEqual({
        ran: true,
        matches: true,
        routerProvider: "email",
        legacyProvider: "email",
        reasonCode: "no_domain_match",
      });
    });

    /** @scenario "Shadow mode compares every login and changes nothing" */
    it("logs a mismatch with both decisions and the reason code", async () => {
      routeMock.mockResolvedValue(redirect);
      vi.mocked(resolveAuthProvider).mockResolvedValue("auth0");

      const result = await run();

      expect(result).toMatchObject({ matches: false });
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          reasonCode: "domain_routed",
          routerProvider: "okta",
          legacyProvider: "auth0",
          routerDecision: expect.objectContaining({
            outcome: "redirect_to_connection",
            connectionId: "org_acme",
            methods: ["okta"],
          }),
        }),
        expect.any(String),
      );
    });

    /** @scenario "Shadow mode compares every login and changes nothing" */
    it("never throws, whatever the router does", async () => {
      routeMock.mockRejectedValue(new Error("the connection store is down"));

      await expect(run()).resolves.toEqual({ ran: false });
      expect(loggerMock.warn).toHaveBeenCalled();
    });

    it("leaves every path that is not a login alone", async () => {
      for (const path of [
        "/api/auth/get-session",
        "/api/auth/sign-up/email",
        "/api/auth/callback/auth0",
        "/api/auth/request-password-reset",
      ]) {
        await expect(run({ path })).resolves.toEqual({ ran: false });
      }
      expect(routeMock).not.toHaveBeenCalled();
    });

    it("routes with no address when the login carries none", async () => {
      await run({
        path: "/api/auth/sign-in/social",
        body: { provider: "okta" },
      });

      expect(routeMock).toHaveBeenCalledWith({
        identifier: null,
        breakGlass: false,
      });
    });
  });
});
