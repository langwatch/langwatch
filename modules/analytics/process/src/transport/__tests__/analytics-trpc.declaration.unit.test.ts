/**
 * The wire names, kinds and permissions of the two analytics tRPC namespaces.
 * The names are the browser's cache keys, so a rename here is a broken page.
 * @vitest-environment node
 */
import { analyticsLwqlTrpc, analyticsTrpc } from "@langwatch/analytics-contract";
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { describe, expect, it } from "vitest";

import { analyticsLwqlTrpcTransport } from "../analytics-lwql.trpc.ts";
import { analyticsTrpcTransport } from "../analytics.trpc.ts";

type ProcedureAccess = Parameters<TrpcProcedureFactory<object>["procedure"]>[0]["access"];

/** Records the permission each declared procedure asked for, in declaration order. */
function permissionsDeclaredBy(declaration: {
  router(runtime: TrpcProcedureFactory<object>, app: (ctx: object) => never): unknown;
}): (string | ProcedureAccess)[] {
  const declared: (string | ProcedureAccess)[] = [];
  declaration.router(
    {
      procedure: ({ access }) => {
        declared.push(access.kind === "permission" ? access.permission : access);
        return {};
      },
      router: (record) => record,
    },
    () => {
      throw new Error("This test mounts but never handles a request");
    },
  );
  return declared;
}

describe("given the analytics tRPC contract", () => {
  describe("when its members are read", () => {
    it("declares the charted reads and the paged feedbacks read the analytics pages call", () => {
      expect(
        Object.entries(analyticsTrpc.members).map(([name, member]) => [name, member.kind]),
      ).toEqual([
        ["getTimeseries", "query"],
        ["dataForFilter", "query"],
        ["topUsedDocuments", "query"],
        ["feedbacks", "query"],
        ["feedbacksPage", "query"],
      ]);
    });

    /** @scenario "The feedback page read needs the same permission as the feedback read" */
    it("guards the feedback page read with the permission the feedback read has", () => {
      const declared = permissionsDeclaredBy(analyticsTrpcTransport);

      expect(
        Object.entries(analyticsTrpc.members).map(([name, member], index) => [
          name,
          member.kind,
          declared[index],
        ]),
      ).toEqual([
        ["getTimeseries", "query", "analytics:view"],
        ["dataForFilter", "query", "analytics:view"],
        ["topUsedDocuments", "query", "cost:view"],
        ["feedbacks", "query", "cost:view"],
        ["feedbacksPage", "query", "cost:view"],
      ]);
    });

    it("names the namespace the browser caches under", () => {
      expect(analyticsTrpc.namespace).toBe("analytics");
    });
  });
});

describe("given the workbench tRPC contract", () => {
  describe("when its members are read", () => {
    it("declares the availability, schema and validate reads and the one run mutation", () => {
      expect(
        Object.entries(analyticsLwqlTrpc.members).map(([name, member]) => [name, member.kind]),
      ).toEqual([
        ["availability", "query"],
        ["schema", "query"],
        ["validate", "query"],
        ["query", "mutation"],
      ]);
    });

    it("carries the dotted namespace the workbench and the audit path both use", () => {
      expect(analyticsLwqlTrpc.namespace).toBe("analytics.lwql");
    });
  });
});

describe("given the server halves of both namespaces", () => {
  describe("when their declarations are read", () => {
    it("binds each namespace to the analytics feature under its own name", () => {
      expect([analyticsTrpcTransport.namespace, analyticsLwqlTrpcTransport.namespace]).toEqual([
        "analytics",
        "analytics.lwql",
      ]);
    });

    it("declares both as tRPC transports the process mounts", () => {
      expect([analyticsTrpcTransport.protocol, analyticsLwqlTrpcTransport.protocol]).toEqual([
        "trpc",
        "trpc",
      ]);
    });
  });
});
