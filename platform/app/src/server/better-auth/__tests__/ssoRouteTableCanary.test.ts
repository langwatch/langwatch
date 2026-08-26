/**
 * The route-table canary over the ENFORCEMENT BACKSTOP (ADR-117 §4).
 *
 * ADR-027 put the license decision in the `before` hook because the hook was
 * the only interception point that saw the legacy `/callback/auth0|okta`
 * rewrite. ADR-117 moves the DECISION to the router's method policy and leaves
 * the hook as the backstop — which is a mechanism change to the one guard a
 * whole license gate rests on. So the canary is doubled rather than moved:
 *
 *   ee/sso/__tests__/ssoRouteTableCanary.test.ts   the path PREDICATE
 *   this file                                      the HOOK, end to end
 *
 * Both read one classification table (`support/betterAuthRouteTable.ts`), so a
 * route better-auth adds fails both by name until a human decides whether it
 * federates.
 *
 * Hermetic — memory adapter, no DB, no network — so it stays in the unit
 * bucket despite constructing a real better-auth instance.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("@ee/sso/sso-gate", () => ({
  platformSSOAllowed: vi.fn(),
  resolveAuthProvider: vi.fn(),
}));

vi.mock("~/env.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/env.mjs")>();
  return {
    ...actual,
    env: { ...actual.env, NEXTAUTH_PROVIDER: "auth0" },
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

import { platformSSOAllowed, resolveAuthProvider } from "@ee/sso/sso-gate";
import {
  concreteUrl,
  ROUTE_CLASSIFICATION,
  registeredRoutes,
} from "../../../../ee/sso/__tests__/support/betterAuthRouteTable";
import { auth } from "../index";

const runBeforeHook = (auth as any).options.hooks.before as (ctx: {
  request?: { url: string };
}) => Promise<void>;

/** The status the hook answered a route with, or null when it let it pass. */
async function refusalStatus(url: string): Promise<number | null> {
  try {
    await runBeforeHook({ request: { url } });
    return null;
  } catch (error) {
    return (error as { statusCode?: number }).statusCode ?? -1;
  }
}

async function statusesByPath(): Promise<Record<string, number | null>> {
  const entries = await Promise.all(
    registeredRoutes().map(
      async (route) =>
        [route.path, await refusalStatus(concreteUrl(route.path))] as const,
    ),
  );
  return Object.fromEntries(entries);
}

const federatingPaths = () =>
  registeredRoutes()
    .map((route) => route.path)
    .filter((path) => ROUTE_CLASSIFICATION[path] === "federating");

describe("the better-auth before-hook as the ADR-117 enforcement backstop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveAuthProvider).mockResolvedValue("auth0");
  });

  describe("given a method policy that carries no licensed federation", () => {
    beforeEach(() => {
      vi.mocked(platformSSOAllowed).mockResolvedValue(false);
    });

    /** @scenario A new federating route cannot appear without being classified */
    it("refuses every federating route the library mounts", async () => {
      const statuses = await statusesByPath();

      expect(
        Object.fromEntries(federatingPaths().map((p) => [p, statuses[p]])),
      ).toEqual(Object.fromEntries(federatingPaths().map((p) => [p, 403])));
    });

    /** @scenario "A never-licensed installation offers no federated method" */
    it("refuses no local route as an SSO refusal", async () => {
      const statuses = await statusesByPath();

      const wronglyForbidden = Object.entries(statuses)
        .filter(([path]) => ROUTE_CLASSIFICATION[path] === "local")
        .filter(([, status]) => status === 403)
        .map(([path]) => path);

      expect(wronglyForbidden).toEqual([]);
    });
  });

  describe("given a method policy that licenses federation", () => {
    beforeEach(() => {
      vi.mocked(platformSSOAllowed).mockResolvedValue(true);
    });

    it("lets every federating route through", async () => {
      const statuses = await statusesByPath();

      expect(
        Object.fromEntries(federatingPaths().map((p) => [p, statuses[p]])),
      ).toEqual(Object.fromEntries(federatingPaths().map((p) => [p, null])));
    });
  });

  describe("given a deployment that names no federated method", () => {
    beforeEach(() => {
      vi.mocked(platformSSOAllowed).mockResolvedValue(false);
      vi.mocked(resolveAuthProvider).mockResolvedValue("email");
    });

    it("leaves the whole route table alone without consulting the gate", async () => {
      const { env } = await import("~/env.mjs");
      const envMock = env as unknown as { NEXTAUTH_PROVIDER: string };
      const configured = envMock.NEXTAUTH_PROVIDER;
      envMock.NEXTAUTH_PROVIDER = "email";
      try {
        const statuses = await statusesByPath();

        expect(Object.values(statuses).every((s) => s === null)).toBe(true);
        expect(platformSSOAllowed).not.toHaveBeenCalled();
      } finally {
        envMock.NEXTAUTH_PROVIDER = configured;
      }
    });
  });
});
