/**
 * The cache plan, the persisted gcTime and the session-version stamp. ADR-164;
 * specs/ui/browser-query-caching.feature.
 */

import { trpcQueryKey } from "@langwatch/api/web";
import {
  cachePlanFor,
  PERSISTED_QUERY_MAX_AGE,
  procedurePathOf,
} from "@langwatch/browser-host/cache-tiers";
import {
  isForbiddenAnswer,
  SESSION_VERSION_HEADER,
  SessionVersionWatch,
  sessionVersionFetch,
} from "@langwatch/browser-host/session-version";
import { describe, expect, it, vi } from "vitest";

import { createUiQueryClient } from "../query-client.ts";

// The shape `defineTrpcContract(...).build()` produces, minus the schemas the plan never reads.
const organizationTrpc = {
  namespace: "organization",
  members: { getAll: { cache: { persist: true } }, getMemberById: {} },
} as const;

const plan = cachePlanFor({ contracts: [organizationTrpc] });

describe("cachePlanFor", () => {
  it("marks only the reads declared persist, by their dotted procedure path", () => {
    expect([...plan.persisted]).toEqual(["organization.getAll"]);
  });
});

describe("procedurePathOf", () => {
  it("reads the path out of a tRPC key", () => {
    expect(procedurePathOf(trpcQueryKey("organization.getAll", { input: {}, type: "query" }))).toBe(
      "organization.getAll",
    );
  });

  it("answers undefined for a key tRPC did not build", () => {
    expect(procedurePathOf(["plain-key"])).toBeUndefined();
  });
});

describe("createUiQueryClient with a cache plan", () => {
  const queryClient = createUiQueryClient({ cachePlan: plan });
  const gcTimeOf = (path: string) =>
    queryClient.defaultQueryOptions({ queryKey: trpcQueryKey(path, { input: {}, type: "query" }) })
      .gcTime;

  it("keeps a persisted read in memory as long as it may be restored", () => {
    expect(gcTimeOf("organization.getAll")).toBe(PERSISTED_QUERY_MAX_AGE);
  });

  it("leaves an undeclared read on the default", () => {
    expect(gcTimeOf("organization.getMemberById")).not.toBe(PERSISTED_QUERY_MAX_AGE);
  });
});

describe("SessionVersionWatch", () => {
  describe("given the first stamp", () => {
    it("takes it as the baseline without invalidating", () => {
      const onNewer = vi.fn();
      const watch = SessionVersionWatch.create();
      watch.onNewer(onNewer);
      watch.observe("7");
      expect(onNewer).not.toHaveBeenCalled();
    });
  });

  describe("given a stamp newer than the one seen", () => {
    it("invalidates once", () => {
      const onNewer = vi.fn();
      const watch = SessionVersionWatch.create();
      watch.onNewer(onNewer);
      watch.observe("7");
      watch.observe("8");
      watch.observe("8");
      expect(onNewer).toHaveBeenCalledTimes(1);
    });
  });

  describe("given an equal, older or unreadable stamp", () => {
    /** @scenario "An equal, older or unreadable session version changes nothing" */
    it("does nothing", () => {
      const onNewer = vi.fn();
      const watch = SessionVersionWatch.create();
      watch.onNewer(onNewer);
      watch.observe("7");
      for (const value of ["7", "6", null, "", "abc", "-1"]) watch.observe(value);
      expect(onNewer).not.toHaveBeenCalled();
    });
  });

  describe("given answers through the wrapped fetch", () => {
    it("reads the stamp off every response", async () => {
      const onNewer = vi.fn();
      const watch = SessionVersionWatch.create();
      watch.onNewer(onNewer);
      let version = "1";
      const fetch = sessionVersionFetch({
        watch,
        fetch: async () => new Response("{}", { headers: { [SESSION_VERSION_HEADER]: version } }),
      });
      await fetch("/api/trpc/x");
      version = "2";
      await fetch("/api/trpc/x");
      expect(onNewer).toHaveBeenCalledTimes(1);
    });
  });
});

describe("a 403 answer", () => {
  it("is recognised by status alone", () => {
    expect(isForbiddenAnswer({ data: { httpStatus: 403 } })).toBe(true);
    expect(isForbiddenAnswer({ data: { httpStatus: 404 } })).toBe(false);
    expect(isForbiddenAnswer(new Error("x"))).toBe(false);
  });
});
