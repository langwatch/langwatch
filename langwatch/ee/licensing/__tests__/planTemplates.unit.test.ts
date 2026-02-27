import { describe, expect, it } from "vitest";
import { PRO_TEMPLATE, ENTERPRISE_TEMPLATE, getPlanTemplate } from "../planTemplates";
import type { LicensePlanLimits } from "../types";

describe("PRO_TEMPLATE", () => {
  it("has type PRO", () => {
    expect(PRO_TEMPLATE.type).toBe("PRO");
  });

  it("has name Pro", () => {
    expect(PRO_TEMPLATE.name).toBe("Pro");
  });

  it("has maxMembers of 10", () => {
    expect(PRO_TEMPLATE.maxMembers).toBe(10);
  });

  it("has maxProjects of 20", () => {
    expect(PRO_TEMPLATE.maxProjects).toBe(20);
  });

  it("has maxMessagesPerMonth of 100000", () => {
    expect(PRO_TEMPLATE.maxMessagesPerMonth).toBe(100000);
  });

  it("has evaluationsCredit of 500", () => {
    expect(PRO_TEMPLATE.evaluationsCredit).toBe(500);
  });

  it("has maxWorkflows of 50", () => {
    expect(PRO_TEMPLATE.maxWorkflows).toBe(50);
  });

  it("has maxPrompts of 50", () => {
    expect(PRO_TEMPLATE.maxPrompts).toBe(50);
  });

  it("has maxEvaluators of 50", () => {
    expect(PRO_TEMPLATE.maxEvaluators).toBe(50);
  });

  it("has maxScenarios of 50", () => {
    expect(PRO_TEMPLATE.maxScenarios).toBe(50);
  });

  it("has maxOnlineEvaluations of 50", () => {
    expect(PRO_TEMPLATE.maxOnlineEvaluations).toBe(50);
  });

  it("has canPublish true", () => {
    expect(PRO_TEMPLATE.canPublish).toBe(true);
  });

  it("has usageUnit of traces", () => {
    expect(PRO_TEMPLATE.usageUnit).toBe("traces");
  });
});

describe("ENTERPRISE_TEMPLATE", () => {
  it("has type ENTERPRISE", () => {
    expect(ENTERPRISE_TEMPLATE.type).toBe("ENTERPRISE");
  });

  it("has name Enterprise", () => {
    expect(ENTERPRISE_TEMPLATE.name).toBe("Enterprise");
  });

  it("has maxMembers of 100", () => {
    expect(ENTERPRISE_TEMPLATE.maxMembers).toBe(100);
  });

  it("has maxProjects of 500", () => {
    expect(ENTERPRISE_TEMPLATE.maxProjects).toBe(500);
  });

  it("has maxMessagesPerMonth of 10000000", () => {
    expect(ENTERPRISE_TEMPLATE.maxMessagesPerMonth).toBe(10000000);
  });

  it("has evaluationsCredit of 10000", () => {
    expect(ENTERPRISE_TEMPLATE.evaluationsCredit).toBe(10000);
  });

  it("has maxWorkflows of 1000", () => {
    expect(ENTERPRISE_TEMPLATE.maxWorkflows).toBe(1000);
  });

  it("has maxPrompts of 1000", () => {
    expect(ENTERPRISE_TEMPLATE.maxPrompts).toBe(1000);
  });

  it("has maxEvaluators of 1000", () => {
    expect(ENTERPRISE_TEMPLATE.maxEvaluators).toBe(1000);
  });

  it("has maxScenarios of 1000", () => {
    expect(ENTERPRISE_TEMPLATE.maxScenarios).toBe(1000);
  });

  it("has maxOnlineEvaluations of 1000", () => {
    expect(ENTERPRISE_TEMPLATE.maxOnlineEvaluations).toBe(1000);
  });

  it("has canPublish true", () => {
    expect(ENTERPRISE_TEMPLATE.canPublish).toBe(true);
  });

  it("has usageUnit of traces", () => {
    expect(ENTERPRISE_TEMPLATE.usageUnit).toBe("traces");
  });
});

describe("getPlanTemplate", () => {
  it("returns PRO template for PRO type", () => {
    const template = getPlanTemplate("PRO");

    expect(template).toEqual(PRO_TEMPLATE);
  });

  it("returns ENTERPRISE template for ENTERPRISE type", () => {
    const template = getPlanTemplate("ENTERPRISE");

    expect(template).toEqual(ENTERPRISE_TEMPLATE);
  });

  it("returns null for CUSTOM type", () => {
    const template = getPlanTemplate("CUSTOM");

    expect(template).toBeNull();
  });

  it("returns null for unknown plan type", () => {
    const template = getPlanTemplate("UNKNOWN");

    expect(template).toBeNull();
  });
});
