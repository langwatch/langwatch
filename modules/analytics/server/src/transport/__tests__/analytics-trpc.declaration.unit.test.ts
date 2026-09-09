/**
 * The wire names, kinds and permissions of the two analytics tRPC namespaces.
 * The names are the browser's cache keys, so a rename here is a broken page.
 * @vitest-environment node
 */
import { analyticsLwqlTrpc, analyticsTrpc } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { analyticsLwqlTrpcTransport } from "../analytics-lwql.trpc.ts";
import { analyticsTrpcTransport } from "../analytics.trpc.ts";

describe("given the analytics tRPC contract", () => {
  describe("when its members are read", () => {
    it("declares the four charted reads the analytics pages call", () => {
      expect(
        Object.entries(analyticsTrpc.members).map(([name, member]) => [name, member.kind]),
      ).toEqual([
        ["getTimeseries", "query"],
        ["dataForFilter", "query"],
        ["topUsedDocuments", "query"],
        ["feedbacks", "query"],
      ]);
    });

    it("names the namespace the browser caches under", () => {
      expect(analyticsTrpc.namespace).toBe("analytics");
    });
  });
});

describe("given the workbench tRPC contract", () => {
  describe("when its members are read", () => {
    it("declares the availability and schema reads and the one run mutation", () => {
      expect(
        Object.entries(analyticsLwqlTrpc.members).map(([name, member]) => [name, member.kind]),
      ).toEqual([
        ["availability", "query"],
        ["schema", "query"],
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
      expect([
        analyticsTrpcTransport.namespace,
        analyticsLwqlTrpcTransport.namespace,
      ]).toEqual(["analytics", "analytics.lwql"]);
    });

    it("declares both as tRPC transports the process mounts", () => {
      expect([analyticsTrpcTransport.protocol, analyticsLwqlTrpcTransport.protocol]).toEqual([
        "trpc",
        "trpc",
      ]);
    });
  });
});
