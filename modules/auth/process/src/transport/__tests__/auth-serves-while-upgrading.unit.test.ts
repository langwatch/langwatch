/**
 * @vitest-environment node
 * Which sign-in routes pass the holding door while the installation upgrades (UIW-6).
 * @see modules/auth/specs/sign-in-while-upgrading.feature
 */
import { routesServingWhileUpgrading } from "@langwatch/api";
import { BearerIdentity, RestHost } from "@langwatch/api/rest";
import type { TrpcProcedureFactory, TrpcRouterMount } from "@langwatch/api/trpc";
import { describe, expect, it } from "vitest";

import { authRest } from "../auth.rest.ts";
import { authTrpcTransport } from "../auth.trpc.ts";

function mountBoth(): (route: string) => boolean {
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
  RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      scim_token: closed,
      instance_admin: closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
  }).mount(authRest.router(), () => {
    throw new Error("no request reaches the door here");
  });
  const runtime: TrpcProcedureFactory<object> = {
    procedure: () => ({}),
    router: (record) => record,
  };
  (authTrpcTransport as { router: TrpcRouterMount<never, never> }).router(runtime, () => {
    throw new Error("no request reaches the door here");
  });
  const patterns = routesServingWhileUpgrading().map((source) => new RegExp(source));

  return (route) => patterns.some((pattern) => pattern.test(route));
}

describe("given the installation upgrading", () => {
  /** @scenario "The Better Auth handler, the session poll, logout and the sign-in reads serve while upgrading" */
  it("passes the session poll, Better Auth's sign-in and SSO callback the sign-in router, logout and the prior session, and holds sign-up and the token check", () => {
    const passes = mountBoth();

    expect(passes("GET /api/auth/session")).toBe(true);
    expect(passes("POST /api/auth/sign-in/email")).toBe(true);
    expect(passes("GET /api/auth/sso/callback/acme")).toBe(true);
    expect(passes("POST /api/trpc/auth.route")).toBe(true);
    expect(passes("POST /api/auth/logout")).toBe(true);
    expect(passes("GET /api/auth/logout")).toBe(true);
    expect(passes("GET /api/trpc/auth.priorSession")).toBe(true);
    expect(passes("POST /api/auth/validate")).toBe(false);
    expect(passes("POST /api/trpc/auth.register")).toBe(false);
    expect(passes("POST /api/trpc/auth.route,auth.register")).toBe(false);
  });
});
