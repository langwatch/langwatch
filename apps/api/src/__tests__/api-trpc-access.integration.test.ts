/**
 * What every installed tRPC procedure declares, swept over the generated module list (Q133 (a)).
 * The REST half is api-route-authorization.integration.test.ts.
 * @vitest-environment node
 * @see specs/rbac/unified-authorization-engine.feature
 */
import type { TrpcAccess, TrpcProcedureRequest } from "@langwatch/api/trpc";
import { describe, expect, it } from "vitest";

import { processModules } from "../process-modules.generated.ts";

type MountedProcedure = { path: string; access: TrpcAccess | undefined };

type TrpcTransport = {
  namespace?: string;
  contract: { members: Record<string, unknown> };
  router: (...args: unknown[]) => unknown;
};

function isTrpcTransport(transport: unknown): transport is TrpcTransport {
  return (
    typeof transport === "object" &&
    transport !== null &&
    (transport as { protocol?: unknown }).protocol === "trpc" &&
    "contract" in transport
  );
}

/** The installed tRPC transports; a transport with no contract is not a tRPC router. */
function trpcTransports(): TrpcTransport[] {
  return processModules
    .flatMap((module): readonly unknown[] => module.transports ?? [])
    .filter(isTrpcTransport);
}

/** Every query, mutation and subscription a contract asks for, as `namespace.name`. */
function contractedProcedures(transports: readonly TrpcTransport[]): string[] {
  return transports.flatMap((transport) =>
    Object.keys(transport.contract.members).map((name) => `${transport.namespace}.${name}`),
  );
}

/** Mounts each router on a runtime that only records what every procedure declares. */
function mountedProcedures(transports: readonly TrpcTransport[]): MountedProcedure[] {
  const mounted: MountedProcedure[] = [];
  for (const transport of transports) {
    transport.router(
      {
        procedure: (request: TrpcProcedureRequest<object>) => {
          mounted.push({ path: request.procedure, access: request.access });
          return request;
        },
        router: (record: unknown) => record,
      },
      () => ({}),
    );
  }
  return mounted;
}

/** Why a declaration does not count: no decision, or an exception with no written reason. */
function missingDecision(access: TrpcAccess | undefined): string | undefined {
  if (access === undefined) return "declares no access";
  if ("reason" in access && access.reason.trim() === "") return `is ${access.kind} with no reason`;
  return undefined;
}

describe("the installed api's tRPC procedures", () => {
  const transports = trpcTransports();
  const mounted = mountedProcedures(transports);

  it("mounts every procedure its contracts declare", () => {
    expect(transports.length).toBeGreaterThan(0);
    expect(mounted.map(({ path }) => path).toSorted()).toEqual(
      contractedProcedures(transports).toSorted(),
    );
  });

  /** @scenario "Every tRPC procedure declares its access decision or an explicit reason not to" */
  it("declares a permission or a named exception with a reason on every procedure", () => {
    const undeclared = mounted.flatMap(({ path, access }) => {
      const missing = missingDecision(access);
      return missing === undefined ? [] : [`${path} ${missing}`];
    });

    expect(mounted.length).toBeGreaterThan(0);
    expect(undeclared).toEqual([]);
  });
});
