import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { publicEndpoint } from "../access-policy.ts";
import {
  registerRoutePolicy,
  routesServingWhileUpgrading,
  type RegisteredRoute,
} from "../route-registry.ts";
import { defineTrpcRouter } from "../trpc/runtime.ts";

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

describe("routesServingWhileUpgrading", () => {
  describe("given one declared route with a param and an undeclared one", () => {
    it("matches only the declared route's method and paths, its v1 twin included", () => {
      const shared: Pick<RegisteredRoute, "policy" | "family" | "credentialClass" | "credential"> =
        {
          policy: publicEndpoint("test route"),
          family: "test",
          credentialClass: "none",
          credential: "public",
        };
      registerRoutePolicy({
        ...shared,
        method: "post",
        path: "/api/upgrade-test/:id/retry",
        canonicalPath: "/api/v1/upgrade-test/:id/retry",
        servesWhileUpgrading: true,
      });
      registerRoutePolicy({ ...shared, method: "get", path: "/api/upgrade-test/:id" });

      const patterns = routesServingWhileUpgrading().map((source) => new RegExp(source));
      const passes = (route: string) => patterns.some((pattern) => pattern.test(route));

      expect(passes("POST /api/upgrade-test/abc/retry")).toBe(true);
      expect(passes("POST /api/v1/upgrade-test/abc/retry")).toBe(true);
      expect(passes("GET /api/upgrade-test/abc/retry")).toBe(false);
      expect(passes("POST /api/upgrade-test/a/b/retry")).toBe(false);
      expect(passes("GET /api/upgrade-test/abc")).toBe(false);
    });
  });

  describe("given a tRPC router where two of three procedures serve while upgrading", () => {
    it("passes a batch only when every procedure in it is declared", () => {
      defineTrpcRouter(UpgradesApi, contract)
        .procedure("plan")
        .servesWhileUpgrading()
        .noPermission({ reason: "test" })
        .handle(({ app }) => app.plan())
        .procedure("retry")
        .servesWhileUpgrading()
        .noPermission({ reason: "test" })
        .handle(({ app }) => app.retry())
        .procedure("purge")
        .noPermission({ reason: "test" })
        .handle(({ app }) => app.purge())
        .build()
        .router({ procedure: () => ({}), router: (record) => record }, () => ({
          plan: async () => ({ ok: true }),
          retry: async () => ({ ok: true }),
          purge: async () => ({ ok: true }),
        }));

      const patterns = routesServingWhileUpgrading().map((source) => new RegExp(source));
      const passes = (route: string) => patterns.some((pattern) => pattern.test(route));

      expect(passes("GET /api/trpc/project.plan")).toBe(true);
      expect(passes("POST /api/trpc/project.plan,project.retry")).toBe(true);
      expect(passes("POST /api/trpc/project.plan,project.purge")).toBe(false);
      expect(passes("POST /api/trpc/project.purge")).toBe(false);
      expect(passes("GET /api/trpc/projectXplan")).toBe(false);
    });
  });
});
