/**
 * Tier resolution and the session-version stamp. ADR-164;
 * specs/ui/browser-query-caching.feature.
 */

import { trpcQueryKey } from "@langwatch/api/web";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  applyCacheTiers,
  CACHE_TIER_STALE_TIME,
  cachePlanFor,
  invalidateSessionTier,
  PERSISTED_QUERY_MAX_AGE,
  procedurePathOf,
} from "../cache-tiers.ts";
import { createUiQueryClient } from "../query-client.ts";
import {
  isForbiddenAnswer,
  SESSION_VERSION_HEADER,
  SessionVersionWatch,
  sessionVersionFetch,
} from "../session-version.ts";

// The shape `defineTrpcContract(...).build()` produces, minus the schemas the plan never reads.
const organizationTrpc = {
  namespace: "organization",
  members: { getAll: { cache: { tier: "session", persist: true } }, getMemberById: {} },
} as const;

const modelProviderTrpc = {
  namespace: "modelProvider",
  members: { getAllForProject: { cache: { tier: "reference" } } },
} as const;

const plan = cachePlanFor({ contracts: [organizationTrpc, modelProviderTrpc] });

describe("cachePlanFor", () => {
  it("keys each declared read by its dotted procedure path", () => {
    expect([...plan.tiers]).toEqual([
      ["organization.getAll", "session"],
      ["modelProvider.getAllForProject", "reference"],
    ]);
  });

  it("marks only the reads declared persist", () => {
    expect([...plan.persisted]).toEqual(["organization.getAll"]);
  });

  it("marks only the reads declared versioned", () => {
    const versioned = cachePlanFor({
      contracts: [
        {
          namespace: "organization",
          members: {
            getScopeGraph: { cache: { tier: "session", persist: true, versioned: true } },
            getAll: { cache: { tier: "session" } },
          },
        },
      ],
    });

    expect([...versioned.versioned]).toEqual(["organization.getScopeGraph"]);
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

describe("applyCacheTiers", () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
  applyCacheTiers({ queryClient, plan });
  const staleTimeOf = (path: string, input: unknown) =>
    queryClient.defaultQueryOptions({ queryKey: trpcQueryKey(path, { input, type: "query" }) })
      .staleTime;

  it("gives a session read no expiry", () => {
    expect(staleTimeOf("organization.getAll", {})).toBe(CACHE_TIER_STALE_TIME.session);
  });

  it("gives a reference read an hour", () => {
    expect(staleTimeOf("modelProvider.getAllForProject", { projectId: "p" })).toBe(3_600_000);
  });

  it("leaves an undeclared read on the default", () => {
    expect(staleTimeOf("organization.getMemberById", { id: "u" })).toBe(30_000);
  });

  it("keeps a persisted read in memory as long as it may be restored", () => {
    const options = queryClient.defaultQueryOptions({
      queryKey: trpcQueryKey("organization.getAll", { input: {}, type: "query" }),
    });
    expect(options.gcTime).toBe(PERSISTED_QUERY_MAX_AGE);
  });
});

describe("invalidateSessionTier", () => {
  it("marks session reads stale and leaves the rest", async () => {
    const queryClient = new QueryClient();
    const session = trpcQueryKey("organization.getAll", { input: {}, type: "query" });
    const reference = trpcQueryKey("modelProvider.getAllForProject", {
      input: { projectId: "p" },
      type: "query",
    });
    queryClient.setQueryData(session, ["org"]);
    queryClient.setQueryData(reference, ["provider"]);

    await invalidateSessionTier({ queryClient, plan });

    expect(queryClient.getQueryState(session)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(reference)?.isInvalidated).toBe(false);
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
  const forbidden = { data: { httpStatus: 403 } };

  it("is recognised by status alone", () => {
    expect(isForbiddenAnswer(forbidden)).toBe(true);
    expect(isForbiddenAnswer({ data: { httpStatus: 404 } })).toBe(false);
    expect(isForbiddenAnswer(new Error("x"))).toBe(false);
  });

  describe("when a mutation is refused", () => {
    it("invalidates the session tier", async () => {
      const queryClient = createUiQueryClient({ cachePlan: plan, onMutationError: () => {} });
      const session = trpcQueryKey("organization.getAll", { input: {}, type: "query" });
      queryClient.setQueryData(session, ["org"]);

      await queryClient
        .getMutationCache()
        .build(queryClient, { mutationFn: () => Promise.reject(forbidden), retry: false })
        .execute(undefined)
        .catch(() => {});
      await vi.waitFor(() => expect(queryClient.getQueryState(session)?.isInvalidated).toBe(true));
    });
  });

  describe("when a session read refuses itself", () => {
    it("does not invalidate the session tier again", async () => {
      const queryClient = createUiQueryClient({ cachePlan: plan });
      const other = trpcQueryKey("organization.getAll", { input: { other: true }, type: "query" });
      queryClient.setQueryData(other, ["org"]);

      await queryClient
        .fetchQuery({
          queryKey: trpcQueryKey("organization.getAll", { input: {}, type: "query" }),
          queryFn: () => Promise.reject(forbidden),
          retry: false,
        })
        .catch(() => {});

      expect(queryClient.getQueryState(other)?.isInvalidated).toBe(false);
    });
  });
});
