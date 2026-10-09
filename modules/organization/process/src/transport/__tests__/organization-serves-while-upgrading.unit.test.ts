/**
 * @vitest-environment node
 * The shell's scope skeleton passes the holding door while the installation upgrades.
 * @see specs/upgrade/in-app-upgrade.feature
 */
import { routesServingWhileUpgrading } from "@langwatch/api";
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { describe, expect, it } from "vitest";

import { organizationTrpcTransport } from "../organization.trpc.ts";

const notCalled = (): never => {
  throw new Error("no request reaches the door here");
};

function passes(route: string): boolean {
  const runtime: TrpcProcedureFactory<object> = {
    procedure: () => ({}),
    router: (record) => record,
  };
  organizationTrpcTransport.router(runtime, notCalled);
  return routesServingWhileUpgrading().some((source) => new RegExp(source).test(route));
}

describe("given the installation upgrading", () => {
  /** @scenario "The shell renders sign-in and the Upgrades page while its other startup reads answer 503" */
  it("passes the scope skeleton and holds the rest of the organization reads", () => {
    expect(passes("GET /api/trpc/organization.getScopeGraph")).toBe(true);
    expect(passes("GET /api/trpc/organization.getAll")).toBe(false);
  });
});
