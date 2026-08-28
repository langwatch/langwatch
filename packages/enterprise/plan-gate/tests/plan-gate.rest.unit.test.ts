/**
 * The REST enterprise gate: reads the organization org auth resolved, asks
 * the plan lookup, and throws `enterprise_plan_required` (402) with the
 * feature and the remediation channel when the plan is not entitled. The
 * response body itself is the family error handler's job, covered by the
 * groups gate integration test.
 */
import { HandledError } from "@langwatch/handled-error";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createEnterprisePlanGate } from "../src";

const getActivePlan = vi.fn();

type TestEnv = {
  Variables: {
    organization: { id: string };
  };
};

const enterprisePlanGate = createEnterprisePlanGate({
  organization: (context) => context.get("organization") as { id: string } | undefined,
  plans: () => ({ getActivePlan }) as never,
});

function buildApp(options: { organization?: { id: string } } = {}) {
  const caught: unknown[] = [];
  const app = new Hono<TestEnv>();
  app.onError((error, c) => {
    caught.push(error);
    return c.json({ caught: true }, 500);
  });
  app.use(async (c, next) => {
    if (options.organization) c.set("organization", options.organization);
    await next();
  });
  app.use(enterprisePlanGate("GROUPS"));
  app.get("/probe", (c) => c.json({ ok: true }));
  return { app, caught };
}

beforeEach(() => {
  getActivePlan.mockReset();
});

describe("the REST Enterprise plan gate", () => {
  describe("when the organization's plan is below Enterprise", () => {
    it("throws enterprise_plan_required with the feature and upgrade guidance", async () => {
      getActivePlan.mockResolvedValue({ type: "FREE" });
      const { app, caught } = buildApp({ organization: { id: "org_1" } });

      await app.request("/probe");

      expect(caught).toHaveLength(1);
      const error = caught[0] as HandledError;
      expect(HandledError.isHandled(error)).toBe(true);
      expect(error.code).toBe("enterprise_plan_required");
      expect(error.httpStatus).toBe(402);
      expect(error.fault).toBe("customer");
      expect(error.meta).toEqual({ feature: "GROUPS" });
      // The remediation channel is the whole point for CLI consumers: tips
      // plus a documentation link ride on the error itself.
      expect(error.tips.length).toBeGreaterThan(0);
      expect(error.docsUrl).toContain("/pricing");
      expect(getActivePlan).toHaveBeenCalledWith({ organizationId: "org_1" });
    });
  });

  describe("when the organization is on an Enterprise plan", () => {
    it("passes through", async () => {
      getActivePlan.mockResolvedValue({ type: "ENTERPRISE" });
      const { app, caught } = buildApp({ organization: { id: "org_1" } });

      const res = await app.request("/probe");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(caught).toEqual([]);
    });
  });

  describe("when the plan lookup fails", () => {
    /** @scenario Guard fails closed when plan lookup fails */
    it("refuses the request rather than letting it through", async () => {
      getActivePlan.mockRejectedValue(new Error("Plan provider unavailable"));
      const { app, caught } = buildApp({ organization: { id: "org_1" } });

      const res = await app.request("/probe");

      expect(res.status).toBe(500);
      expect(caught).toHaveLength(1);
      expect(HandledError.isHandled(caught[0])).toBe(false);
    });
  });

  describe("when no organization is on the context", () => {
    it("throws a plain error for a wiring mistake, not a customer refusal", async () => {
      const { app, caught } = buildApp();

      await app.request("/probe");

      expect(caught).toHaveLength(1);
      expect(HandledError.isHandled(caught[0])).toBe(false);
      expect(getActivePlan).not.toHaveBeenCalled();
    });
  });
});
