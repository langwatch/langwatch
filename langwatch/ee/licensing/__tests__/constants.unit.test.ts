import { describe, expect, it } from "vitest";
import { FREE_PLAN, UNLIMITED_PLAN } from "../constants";

describe("UNLIMITED_PLAN constant", () => {
  it("has correct type for backward compatibility", () => {
    expect(UNLIMITED_PLAN.type).toBe("SELF_HOSTED");
  });

  it("has correct name", () => {
    expect(UNLIMITED_PLAN.name).toBe("Self-Hosted (Unlimited)");
  });

  it("has free set to true", () => {
    expect(UNLIMITED_PLAN.free).toBe(true);
  });

  it("has overrideAddingLimitations set to true", () => {
    expect(UNLIMITED_PLAN.overrideAddingLimitations).toBe(true);
  });

  it("has high maxMembers limit", () => {
    expect(UNLIMITED_PLAN.maxMembers).toBe(99_999);
  });

  it("has high maxProjects limit", () => {
    expect(UNLIMITED_PLAN.maxProjects).toBe(9_999);
  });

  it("has very high maxMessagesPerMonth limit", () => {
    expect(UNLIMITED_PLAN.maxMessagesPerMonth).toBe(999_999_999);
  });

  it("has high evaluationsCredit limit", () => {
    expect(UNLIMITED_PLAN.evaluationsCredit).toBe(999_999);
  });

  it("has high maxWorkflows limit", () => {
    expect(UNLIMITED_PLAN.maxWorkflows).toBe(9_999);
  });

  it("has canPublish set to true", () => {
    expect(UNLIMITED_PLAN.canPublish).toBe(true);
  });

  it("has zero prices", () => {
    expect(UNLIMITED_PLAN.prices).toEqual({ USD: 0, EUR: 0 });
  });
});

describe("FREE_PLAN constant", () => {
  it("has correct type", () => {
    expect(FREE_PLAN.type).toBe("FREE");
  });

  it("has correct name", () => {
    expect(FREE_PLAN.name).toBe("Free");
  });

  it("has free set to true", () => {
    expect(FREE_PLAN.free).toBe(true);
  });

  it("has maxMembers limit of 2", () => {
    expect(FREE_PLAN.maxMembers).toBe(2);
  });

  it("has maxProjects limit of 2", () => {
    expect(FREE_PLAN.maxProjects).toBe(2);
  });

  it("has maxMessagesPerMonth limit of 1000", () => {
    expect(FREE_PLAN.maxMessagesPerMonth).toBe(1_000);
  });

  it("has evaluationsCredit limit of 2", () => {
    expect(FREE_PLAN.evaluationsCredit).toBe(2);
  });

  it("has maxWorkflows limit of 1", () => {
    expect(FREE_PLAN.maxWorkflows).toBe(1);
  });

  it("has canPublish set to false", () => {
    expect(FREE_PLAN.canPublish).toBe(false);
  });

  it("has overrideAddingLimitations set to false", () => {
    expect(FREE_PLAN.overrideAddingLimitations).toBe(false);
  });

  it("has zero prices", () => {
    expect(FREE_PLAN.prices).toEqual({ USD: 0, EUR: 0 });
  });
});
