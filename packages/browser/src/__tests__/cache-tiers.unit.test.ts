/**
 * The cache plan, the persisted gcTime and the session-version stamp. ADR-170;
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
import { defineTrpcContract, SCHEMA_HASH_HEADER, schemaHashesOf } from "@langwatch/module";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createUiQueryClient } from "../query-client.ts";

const memberSchema = z.object({ id: z.string() });
const organizationTrpc = defineTrpcContract("organization")
  .query("getAll")
  .withInput(z.object({}))
  .withOutput(z.array(z.string()))
  .query("getMemberById")
  .withInput(memberSchema)
  .withOutput(memberSchema)
  .mutation("rename")
  .withInput(memberSchema)
  .withOutput(memberSchema)
  .build();

const plan = cachePlanFor({ contracts: [organizationTrpc] });
const excludingMember = cachePlanFor({
  contracts: [organizationTrpc],
  excluded: new Set(["organization.getMemberById"]),
});

describe("cachePlanFor", () => {
  it("mirrors every declared query by its dotted procedure path, and no mutation", () => {
    expect([...plan.persisted].toSorted()).toEqual([
      "organization.getAll",
      "organization.getMemberById",
    ]);
  });

  it("leaves out a read on the exclusion list", () => {
    expect([...excludingMember.persisted]).toEqual(["organization.getAll"]);
    expect(excludingMember.schemaHashFor("organization.getMemberById")).toBeUndefined();
  });

  it("gives each mirrored read the schema hash its contract declares, and nothing else one", () => {
    const declared = schemaHashesOf(organizationTrpc);

    expect(plan.schemaHashFor("organization.getAll")).toBe(declared["organization.getAll"]);
    expect(plan.schemaHashFor("organization.rename")).toBeUndefined();
    expect(plan.schemaHashFor("elsewhere.read")).toBeUndefined();
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

describe("createUiQueryClient", () => {
  const queryClient = createUiQueryClient();
  const gcTimeOf = (path: string) =>
    queryClient.defaultQueryOptions({ queryKey: trpcQueryKey(path, { input: {}, type: "query" }) })
      .gcTime;

  it("keeps every read in memory as long as its mirror, from one default", () => {
    expect(gcTimeOf("organization.getAll")).toBe(PERSISTED_QUERY_MAX_AGE);
    expect(queryClient.getQueryDefaults(trpcQueryKey("organization.getAll"))).toEqual({});
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

    it("records the schema hash a query answer carried, by its procedure path", async () => {
      const watch = SessionVersionWatch.create();
      const fetch = sessionVersionFetch({
        watch,
        fetch: async (input) =>
          new Response("{}", {
            headers:
              typeof input === "string" && input.includes("getAll")
                ? { [SCHEMA_HASH_HEADER]: "schema-2" }
                : {},
          }),
      });
      await fetch("/api/trpc/organization.getAll?input=%7B%7D");
      await fetch("/api/trpc/organization.rename", { method: "POST" });

      expect(watch.servedSchemaHashFor("organization.getAll")).toBe("schema-2");
      expect(watch.servedSchemaHashFor("organization.rename")).toBeUndefined();
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
