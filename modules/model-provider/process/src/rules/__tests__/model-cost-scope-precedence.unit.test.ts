/**
 * Spec: specs/model-providers/model-cost-scoping.feature
 */
import type { ModelCost } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";
import { byScopePrecedence } from "../model-cost-scope-precedence.rules.ts";

function cost({
  scopeType,
  scopeId,
  createdAt,
  inputCostPerToken,
}: {
  scopeType: ModelCost["scopeType"];
  scopeId: string;
  createdAt: Date;
  inputCostPerToken: number;
}): ModelCost {
  return {
    id: `llmcost_${scopeType}`,
    organizationId: "org-1",
    projectId: scopeType === "PROJECT" ? scopeId : null,
    scopeType,
    scopeId,
    model: "openai/gpt-5-mini",
    regex: "^openai\\/gpt-5-mini$",
    inputCostPerToken,
    outputCostPerToken: inputCostPerToken * 2,
    cacheReadCostPerToken: null,
    cacheCreationCostPerToken: null,
    cacheCreation1hCostPerToken: null,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("byScopePrecedence", () => {
  describe("given an organization row and a project row for the same model", () => {
    describe("when the rows are ordered for matching", () => {
      /** @scenario A project-level custom cost beats the organization rate at ingestion */
      it("puts the project row first, whichever row was saved last", () => {
        // The organization row is the NEWER of the two, so creation order alone
        // would price the project's spans at the organization rate.
        const organization = cost({
          scopeType: "ORGANIZATION",
          scopeId: "org-1",
          createdAt: new Date("2026-02-01"),
          inputCostPerToken: 0.000003,
        });
        const project = cost({
          scopeType: "PROJECT",
          scopeId: "project-1",
          createdAt: new Date("2026-01-01"),
          inputCostPerToken: 0.000001,
        });

        const ordered = byScopePrecedence([organization, project]);

        expect(ordered.map((row) => row.scopeType)).toEqual(["PROJECT", "ORGANIZATION"]);
        expect(ordered[0]?.inputCostPerToken).toBe(0.000001);
      });
    });
  });

  describe("given two rows at the same scope", () => {
    describe("when the rows are ordered for matching", () => {
      it("puts the newer one first", () => {
        const older = cost({
          scopeType: "TEAM",
          scopeId: "team-1",
          createdAt: new Date("2026-01-01"),
          inputCostPerToken: 0.000005,
        });
        const newer = cost({
          scopeType: "TEAM",
          scopeId: "team-1",
          createdAt: new Date("2026-03-01"),
          inputCostPerToken: 0.000007,
        });

        expect(byScopePrecedence([older, newer])[0]?.inputCostPerToken).toBe(0.000007);
      });
    });
  });
});
