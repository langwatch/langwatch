import { validateMount } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { evaluationAnalyticsMount } from "./evaluationAnalytics.mount";

describe("evaluationAnalyticsMount", () => {
  it("is a legal mount per ADR-106's validateMount", () => {
    expect(validateMount(evaluationAnalyticsMount)).toEqual([]);
  });
});
