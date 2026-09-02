import {
  PLATFORM_DEFAULT_DATA_PRIVACY,
  PRIVACY_DROPPED_MARKER_ATTR,
  type DataPrivacyService,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";
import { TraceSpanContentDropPort } from "@langwatch/trace-server";
import { describe, expect, it, vi } from "vitest";
import { createWorkerTraceContentDrop } from "../worker-trace-content-drop.composition";

/**
 * Spec: packages/features/data-privacy/specs/span-content-drop.feature
 *
 * A COMPOSITION-CAPABILITY test. Trace has not converted, so nothing in this
 * process drops content. What has to be true today is that this composition
 * root can honour a customer's `drop` from the two things it already holds —
 * the scoped data-privacy service and the enforcement flag — and that it does
 * so THROUGH the port `RecordSpanCommand` names, because that port is the
 * whole reason the drop is composable outside the application.
 */

function dropInput(): ResolvedDataPrivacy {
  return {
    ...PLATFORM_DEFAULT_DATA_PRIVACY,
    categories: {
      ...PLATFORM_DEFAULT_DATA_PRIVACY.categories,
      input: { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories.input, disposition: "drop" },
    },
    customAttributes: [],
  };
}

function span(): OtlpSpan {
  return {
    traceId: "trace-1",
    spanId: "span-1",
    name: "llm-call",
    kind: 1,
    startTimeUnixNano: { low: 0, high: 0 },
    endTimeUnixNano: { low: 1_000_000, high: 0 },
    attributes: [
      { key: "gen_ai.prompt", value: { stringValue: "a customer's prompt" } },
      { key: "gen_ai.usage.input_tokens", value: { stringValue: "12" } },
    ],
    events: [],
    links: [],
    status: {},
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

function dataPrivacy(): {
  service: DataPrivacyService;
  getResolvedForProject: ReturnType<typeof vi.fn>;
} {
  const getResolvedForProject = vi.fn(async () => dropInput());
  return {
    service: { getResolvedForProject } as unknown as DataPrivacyService,
    getResolvedForProject,
  };
}

describe("createWorkerTraceContentDrop", () => {
  describe("given a scoped data-privacy service and enforcement on", () => {
    describe("when the drop graph is composed", () => {
      /** @scenario "The content drop composes from the policy service alone" */
      it("answers the narrow port the record command names", () => {
        const { service } = dataPrivacy();

        const graph = createWorkerTraceContentDrop({
          dataPrivacy: service,
          nativePolicyEnforced: true,
        });

        expect(graph.spanContentDropPort()).toBeInstanceOf(TraceSpanContentDropPort);
      });

      /** @scenario "The composed path removes a dropped category's content" */
      it("strips the customer's prompt and stamps the marker, through the port", async () => {
        const { service, getResolvedForProject } = dataPrivacy();
        const graph = createWorkerTraceContentDrop({
          dataPrivacy: service,
          nativePolicyEnforced: true,
        });
        const target = span();

        const result = await graph.spanContentDropPort().drop(target, "project-4");

        expect(getResolvedForProject).toHaveBeenCalledWith({ projectId: "project-4" });
        expect(target.attributes.map((attr) => attr.key)).toEqual([
          "gen_ai.usage.input_tokens",
          PRIVACY_DROPPED_MARKER_ATTR,
        ]);
        expect(result).toEqual({
          droppedCount: 1,
          droppedCategories: ["input"],
          droppedAttributeKeys: [],
        });
      });
    });
  });

  describe("given enforcement is off", () => {
    describe("when a span passes through the port", () => {
      /** @scenario "With enforcement off nothing is dropped and no policy is read" */
      it("leaves the span whole and never resolves a policy", async () => {
        const { service, getResolvedForProject } = dataPrivacy();
        const graph = createWorkerTraceContentDrop({
          dataPrivacy: service,
          nativePolicyEnforced: false,
        });
        const target = span();

        const result = await graph.spanContentDropPort().drop(target, "project-4");

        expect(getResolvedForProject).not.toHaveBeenCalled();
        expect(target.attributes.map((attr) => attr.key)).toEqual([
          "gen_ai.prompt",
          "gen_ai.usage.input_tokens",
        ]);
        expect(result.droppedCount).toBe(0);
      });
    });
  });
});
