import { describe, expect, it } from "vitest";
import {
  collapseKillSwitchDescriptorsByKey,
  describeKillSwitchMounts,
  type KillSwitchDescriptor,
} from "../introspection";

function descriptor(
  overrides: Partial<KillSwitchDescriptor> = {},
): KillSwitchDescriptor {
  return {
    key: "es-trace-subscriber-traceUpdateBroadcast-killswitch",
    aggregateType: "trace",
    componentType: "subscriber",
    componentName: "traceUpdateBroadcast",
    pipelineName: "trace_processing",
    ...overrides,
  };
}

/**
 * A kill switch is one control, but the generator emits one descriptor per
 * MOUNT. Anything that lists switches has to collapse them, or an operator sees
 * several identical rows and reasonably concludes they are independent.
 */
describe("collapseKillSwitchDescriptorsByKey", () => {
  describe("given a subscriber mounted on several pipelines behind one shared key", () => {
    const sharedKey =
      "es-billing_report-subscriber-billingMeterPoke-killswitch";
    const mounts = [
      descriptor({
        key: sharedKey,
        componentName: "billingMeterPoke",
        pipelineName: "trace_processing",
      }),
      descriptor({
        key: sharedKey,
        componentName: "billingMeterPoke",
        pipelineName: "evaluation_processing",
      }),
      descriptor({
        key: sharedKey,
        componentName: "billingMeterPoke",
        pipelineName: "experiment_run_processing",
      }),
      descriptor({
        key: sharedKey,
        componentName: "billingMeterPoke",
        pipelineName: "simulation_processing",
      }),
    ];

    it("yields one entry, not one per mount", () => {
      const collapsed = collapseKillSwitchDescriptorsByKey(mounts);

      expect(collapsed).toHaveLength(1);
      expect(collapsed[0]?.key).toBe(sharedKey);
    });

    it("keeps every mount the single key controls", () => {
      const collapsed = collapseKillSwitchDescriptorsByKey(mounts);

      expect(collapsed[0]?.mounts.map((m) => m.pipelineName)).toEqual([
        "trace_processing",
        "evaluation_processing",
        "experiment_run_processing",
        "simulation_processing",
      ]);
    });
  });

  describe("given descriptors with distinct keys", () => {
    it("keeps them apart", () => {
      const collapsed = collapseKillSwitchDescriptorsByKey([
        descriptor({ key: "es-trace-projection-traceSummary-killswitch" }),
        descriptor({ key: "es-trace-command-recordSpan-killswitch" }),
      ]);

      expect(collapsed.map((entry) => entry.key)).toEqual([
        "es-trace-projection-traceSummary-killswitch",
        "es-trace-command-recordSpan-killswitch",
      ]);
    });

    it("preserves first-seen order so the listing does not reshuffle between reads", () => {
      const keys = ["es-c-killswitch", "es-a-killswitch", "es-b-killswitch"];
      const collapsed = collapseKillSwitchDescriptorsByKey(
        keys.map((key) => descriptor({ key })),
      );

      expect(collapsed.map((entry) => entry.key)).toEqual(keys);
    });
  });

  describe("given no descriptors", () => {
    it("yields nothing rather than throwing", () => {
      expect(collapseKillSwitchDescriptorsByKey([])).toEqual([]);
    });
  });
});

describe("describeKillSwitchMounts", () => {
  describe("when one key spans several pipelines", () => {
    it("names every pipeline and component the switch stops", () => {
      const described = describeKillSwitchMounts([
        descriptor({
          componentName: "billingMeterPoke",
          pipelineName: "trace_processing",
        }),
        descriptor({
          componentName: "billingMeterPoke",
          pipelineName: "simulation_processing",
        }),
      ]);

      expect(described).toBe(
        "trace_processing: subscriber billingMeterPoke; simulation_processing: subscriber billingMeterPoke",
      );
    });
  });

  describe("when the switch covers a single mount", () => {
    it("describes it without a separator", () => {
      const described = describeKillSwitchMounts([
        descriptor({
          componentType: "projection",
          componentName: "traceSummary",
          pipelineName: "trace_processing",
        }),
      ]);

      expect(described).toBe("trace_processing: projection traceSummary");
    });
  });
});
