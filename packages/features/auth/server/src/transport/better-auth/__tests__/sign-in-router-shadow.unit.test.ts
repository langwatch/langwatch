import { beforeEach, describe, expect, it, vi } from "vitest";

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("@langwatch/observability", () => ({ createLogger: () => loggerMock }));

import type { RoutingDecision, SignInMethod } from "@langwatch/identity-contract";
import {
  runSignInRouterShadow,
  type SignInRouterMode,
  type SignInRouterShadowPort,
} from "../sign-in-router-shadow";

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

let mode: SignInRouterMode = "shadow";
const routeMock = vi.fn<SignInRouterShadowPort["route"]>();
const resolveAuthProviderMock = vi.fn<SignInRouterShadowPort["resolveAuthProvider"]>();

const shadow: SignInRouterShadowPort = {
  mode: () => mode,
  route: routeMock,
  resolveAuthProvider: resolveAuthProviderMock,
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
    shadow,
  });

describe("the identity router's shadow comparison", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mode = "shadow";
    routeMock.mockResolvedValue(picker);
    resolveAuthProviderMock.mockResolvedValue("email");
  });

  describe("given the flag is off", () => {
    beforeEach(() => {
      mode = "off";
    });

    /** @scenario "The flag off restores the legacy path entirely" */
    it("computes nothing, reads nothing and logs nothing", async () => {
      await expect(run()).resolves.toEqual({ ran: false });

      expect(routeMock).not.toHaveBeenCalled();
      expect(resolveAuthProviderMock).not.toHaveBeenCalled();
      expect(loggerMock.warn).not.toHaveBeenCalled();
    });

    /** @scenario "The flag off restores the legacy path entirely" */
    it("stays inert after the flag has been enforced and turned back off", async () => {
      mode = "enforce";
      await run();
      expect(routeMock).not.toHaveBeenCalled();

      mode = "off";
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
      resolveAuthProviderMock.mockResolvedValue("auth0");

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
