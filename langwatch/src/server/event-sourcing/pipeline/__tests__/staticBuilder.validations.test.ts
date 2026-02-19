import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { definePipeline } from "../staticBuilder";
import {
  createMockFoldProjectionDefinition,
} from "../../services/__tests__/testHelpers";
import type { Event } from "../../domain/types";

describe("StaticPipelineBuilder validations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("when fold projection with custom key is registered", () => {
    it("builds successfully", () => {
      const fold = {
        ...createMockFoldProjectionDefinition<Event>("withKey"),
        key: (event: Event) => String(event.tenantId),
      };

      expect(() =>
        definePipeline<Event>()
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withFoldProjection("withKey", fold)
          .build(),
      ).not.toThrow();
    });
  });

  describe("when fold projection without custom key is registered", () => {
    it("builds successfully", () => {
      const fold = createMockFoldProjectionDefinition<Event>("simple");

      expect(() =>
        definePipeline<Event>()
          .withName("test-pipeline")
          .withAggregateType("trace")
          .withFoldProjection("simple", fold)
          .build(),
      ).not.toThrow();
    });
  });
});
