/**
 * Main's GLOBAL_QUEUE_CONCURRENCY, LANGWATCH_DISPATCH_TENANT_CAP and
 * LANGWATCH_DISPATCH_GLOBAL_BUDGET reach the queue policy of both roles.
 */
import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { storesOwner } from "../config-owner.ts";
import { PipelineParticipation } from "../pipeline-selection.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [storesOwner], environment }).stores;

const settingsFor = (environment: Record<string, string | undefined>) => {
  const config = read(environment);
  return {
    defaultRetentionDays: config.defaultRetentionDays,
    queueConcurrency: config.queueConcurrency,
    queueTenantCap: config.queueTenantCap,
    queueGlobalBudget: config.queueGlobalBudget,
  };
};

const policyFor = (environment: Record<string, string | undefined>) =>
  PipelineParticipation.consumer().configure(settingsFor(environment)).groupQueue?.policy;

describe("queue policy settings", () => {
  describe("given all three are set", () => {
    const environment = {
      GLOBAL_QUEUE_CONCURRENCY: "250",
      LANGWATCH_DISPATCH_TENANT_CAP: "80",
      LANGWATCH_DISPATCH_GLOBAL_BUDGET: "1000",
    };

    it("hands the consuming role's queue the configured values", () => {
      expect(policyFor(environment)).toEqual({
        globalConcurrency: 250,
        tenantConcurrencyCap: 80,
        globalConcurrencyBudget: 1000,
      });
    });

    it("hands the producing role's queue the same values", () => {
      const producing = PipelineParticipation.producer().configure(settingsFor(environment));
      expect(producing.groupQueue?.policy?.globalConcurrency).toBe(250);
    });
  });

  describe("given none is set, or they are blank", () => {
    it.each([{}, { GLOBAL_QUEUE_CONCURRENCY: "", LANGWATCH_DISPATCH_TENANT_CAP: " " }])(
      "leaves the queue's own defaults",
      (environment) => {
        expect(policyFor(environment)).toBeUndefined();
      },
    );
  });

  describe("given the tenant cap is 0", () => {
    it("passes the kill switch through", () => {
      expect(policyFor({ LANGWATCH_DISPATCH_TENANT_CAP: "0" })).toEqual({
        tenantConcurrencyCap: 0,
      });
    });
  });

  describe("given values that are not valid numbers", () => {
    it("keeps the defaults", () => {
      expect(
        policyFor({ GLOBAL_QUEUE_CONCURRENCY: "abc", LANGWATCH_DISPATCH_TENANT_CAP: "-5" }),
      ).toBeUndefined();
    });
  });
});
