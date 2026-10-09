/**
 * Every route serves while the installation upgrades unless it holds, with a reason (API-UP).
 * Spec: specs/upgrade/in-app-upgrade.feature
 */
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { publicEndpoint } from "../access-policy.ts";
import {
  registerRoutePolicy,
  routesHeldWhileUpgrading,
  type RegisteredRoute,
} from "../route-registry.ts";
import { defineTrpcRouter } from "../trpc/runtime.ts";
import { SseLane } from "../trpc/sse.ts";

interface UpgradesApi {
  plan(): Promise<{ ok: boolean }>;
  retry(): Promise<{ ok: boolean }>;
  purge(): Promise<{ ok: boolean }>;
}

const UpgradesApi = moduleApi<UpgradesApi>()("project");
const answer = z.object({ ok: z.boolean() });
const contract = defineTrpcContract("project")
  .query("plan")
  .withInput(z.object({}))
  .withOutput(answer)
  .mutation("retry")
  .withInput(z.object({}))
  .withOutput(answer)
  .mutation("purge")
  .withInput(z.object({}))
  .withOutput(answer)
  .build();

const serves = (route: string): boolean =>
  !routesHeldWhileUpgrading().some((source) => new RegExp(source).test(route));

const shared: Pick<RegisteredRoute, "policy" | "family" | "credentialClass" | "credential"> = {
  policy: publicEndpoint("test route"),
  family: "test",
  credentialClass: "none",
  credential: "public",
};

describe("routesHeldWhileUpgrading", () => {
  describe("given one route held with a reason and one that says nothing", () => {
    /** @scenario "Every route serves while upgrading unless it holds, naming why" */
    it("holds only the held route's method and paths, its v1 twin included", () => {
      registerRoutePolicy({
        ...shared,
        method: "post",
        path: "/api/upgrade-test/:id/purge",
        canonicalPath: "/api/v1/upgrade-test/:id/purge",
        holdsWhileUpgrading: { because: "the fixture's purge races the upgrade" },
      });
      registerRoutePolicy({ ...shared, method: "get", path: "/api/upgrade-test/:id" });

      expect(serves("POST /api/upgrade-test/abc/purge")).toBe(false);
      expect(serves("POST /api/v1/upgrade-test/abc/purge")).toBe(false);
      expect(serves("GET /api/upgrade-test/abc/purge")).toBe(true);
      expect(serves("GET /api/upgrade-test/abc")).toBe(true);
    });
  });

  describe("given a tRPC router where one of three procedures holds", () => {
    function mountUpgrades(): void {
      defineTrpcRouter(UpgradesApi, contract)
        .procedure("plan")
        .noPermission({ reason: "test" })
        .handle(({ app }) => app.plan())
        .procedure("retry")
        .noPermission({ reason: "test" })
        .handle(({ app }) => app.retry())
        .procedure("purge")
        .holdsWhileUpgrading({ because: "the fixture's purge races the upgrade" })
        .noPermission({ reason: "test" })
        .handle(({ app }) => app.purge())
        .build()
        .router({ procedure: () => ({}), router: (record) => record }, () => ({
          plan: async () => ({ ok: true }),
          retry: async () => ({ ok: true }),
          purge: async () => ({ ok: true }),
        }));
    }

    /** @scenario "Every route serves while upgrading unless it holds, naming why" */
    it("serves a batch of serving procedures and holds any batch naming the held one", () => {
      mountUpgrades();

      expect(serves("GET /api/trpc/project.plan")).toBe(true);
      expect(serves("POST /api/trpc/project.plan,project.retry")).toBe(true);
      expect(serves("POST /api/trpc/project.plan,project.purge")).toBe(false);
      expect(serves("POST /api/trpc/project.purge,project.plan")).toBe(false);
      expect(serves("POST /api/trpc/project.purge")).toBe(false);
      expect(serves("POST /api/trpc/project.purgeAll")).toBe(true);
    });

    /** @scenario "Every route serves while upgrading unless it holds, naming why" */
    it("serves a subscription stream by default and holds the held procedure's stream", () => {
      SseLane.create({
        members: { createCaller: async () => ({}), procedureTypeAt: () => "subscription" },
      });
      mountUpgrades();

      expect(serves("GET /api/sse/project.plan")).toBe(true);
      expect(serves("GET /api/sse/project.purge")).toBe(false);
      expect(serves("GET /api/sse/project/purge")).toBe(false);
    });

    it("refuses a hold that names no reason", () => {
      expect(() =>
        defineTrpcRouter(UpgradesApi, contract)
          .procedure("plan")
          .holdsWhileUpgrading({ because: " " }),
      ).toThrow(/without saying why/);
    });
  });
});
