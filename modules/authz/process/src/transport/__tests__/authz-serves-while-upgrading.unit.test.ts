/**
 * @vitest-environment node
 * The shell's permission read passes the holding door while the installation upgrades.
 * @see specs/upgrade/in-app-upgrade.feature
 */
import { routesHeldWhileUpgrading } from "@langwatch/api";
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { describe, expect, it } from "vitest";

import { authzTrpcTransport } from "../authz.trpc.ts";

const notCalled = (): never => {
  throw new Error("no request reaches the door here");
};

function passes(route: string): boolean {
  const runtime: TrpcProcedureFactory<object> = {
    procedure: () => ({}),
    router: (record) => record,
  };
  authzTrpcTransport.router(runtime, notCalled);
  return !routesHeldWhileUpgrading().some((source) => new RegExp(source).test(route));
}

describe("given the installation upgrading", () => {
  /** @scenario "The shell's startup reads serve while the installation upgrades" */
  it("passes every read, the shell's startup reads included", () => {
    expect(passes("GET /api/trpc/authz.effectivePermissions")).toBe(true);
    expect(passes("GET /api/trpc/authz.listGrants")).toBe(true);
  });
});
