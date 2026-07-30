/**
 * @vitest-environment jsdom
 *
 * The composer's live threshold preview is the only place an admin is told
 * what their rule will do before they save it, so it has to agree with the
 * two things that actually decide: `spendSpikeThresholdConfigSchema` (what
 * `anomalyRules.create` accepts) and the spend-spike evaluator (what the
 * rule then does). It once required a fourth key, `baselineOffsetSec`, that
 * neither of them has ever read — a config straight out of the docs rendered
 * red while saving perfectly well.
 *
 * Spec: specs/ai-gateway/governance/anomaly-rule-threshold-schema.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  ALLOWED_RULE_TYPES,
  safeParseSpendSpikeThresholdConfig,
} from "@ee/governance/services/activity-monitor/thresholdConfig.schema";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  SPEND_SPIKE_THRESHOLD_TEMPLATE,
  ThresholdPreview,
} from "../ThresholdPreview";

function preview({ ruleType, raw }: { ruleType: string; raw: string }) {
  render(
    <ChakraProvider value={defaultSystem}>
      <ThresholdPreview ruleType={ruleType} raw={raw} />
    </ChakraProvider>,
  );
  return {
    verdict: screen.getByTestId("threshold-preview-verdict").textContent ?? "",
    sentence: screen.getByTestId("threshold-preview-text").textContent ?? "",
  };
}

const VALID_CONFIG = JSON.stringify(
  { windowSec: 86400, ratioVsBaseline: 2, minBaselineUsd: 1 },
  null,
  2,
);

describe("ThresholdPreview", () => {
  describe("given a spend_spike config the create call accepts", () => {
    describe("when the admin has typed the three keys the schema requires", () => {
      /** @scenario "The composer preview accepts the same spend_spike config the create call accepts" */
      it("shows the rule's behaviour rather than a validation error", () => {
        // Pin the premise: this is a config `anomalyRules.create` takes.
        expect(
          safeParseSpendSpikeThresholdConfig(JSON.parse(VALID_CONFIG)).ok,
        ).toBe(true);

        const { verdict, sentence } = preview({
          ruleType: "spend_spike",
          raw: VALID_CONFIG,
        });

        expect(verdict).not.toBe("Invalid");
        expect(sentence).not.toMatch(/baselineOffsetSec/);
      });

      /** @scenario "The composer preview describes the baseline the evaluator actually uses" */
      it("describes the baseline as the six periods before this one", () => {
        const { sentence } = preview({
          ruleType: "spend_spike",
          raw: VALID_CONFIG,
        });

        expect(sentence).toContain("the last day");
        expect(sentence).toContain("2×");
        expect(sentence).toContain("average of the previous six days");
        expect(sentence).toContain("$1");
        // The rule has never compared against a fixed point in the past.
        expect(sentence).not.toMatch(/ago/);
      });
    });

    describe("when the config carries a key this rule type does not read", () => {
      /** @scenario "The composer preview says which threshold keys the rule ignores" */
      it("still previews the rule and names the ignored key", () => {
        const { verdict, sentence } = preview({
          ruleType: "spend_spike",
          raw: JSON.stringify({
            windowSec: 86400,
            ratioVsBaseline: 2,
            minBaselineUsd: 1,
            baselineOffsetSec: 604800,
          }),
        });

        // Unknown keys are dropped on read, not refused on save — rules
        // created from the old template still hold this one.
        expect(verdict).toBe("Preview");
        expect(sentence).toContain("baselineOffsetSec");
        expect(sentence).toMatch(/ignored/i);
      });
    });
  });

  describe("given a spend_spike config the create call refuses", () => {
    const refused: Array<{ case: string; config: Record<string, unknown> }> = [
      {
        case: "a negative window",
        config: { windowSec: -5, ratioVsBaseline: 2, minBaselineUsd: 1 },
      },
      {
        case: "a fractional window",
        config: { windowSec: 1.5, ratioVsBaseline: 2, minBaselineUsd: 1 },
      },
      {
        case: "a zero ratio",
        config: { windowSec: 86400, ratioVsBaseline: 0, minBaselineUsd: 1 },
      },
      {
        case: "a negative floor",
        config: { windowSec: 86400, ratioVsBaseline: 2, minBaselineUsd: -1 },
      },
      {
        case: "a missing key",
        config: { windowSec: 86400, ratioVsBaseline: 2 },
      },
      {
        case: "a snake_case typo",
        config: {
          window_sec: 86400,
          ratio_vs_baseline: 2,
          min_baseline_usd: 1,
        },
      },
    ];

    describe("when the admin has typed a value the schema rejects", () => {
      /** @scenario "The composer preview refuses the field values the create call refuses" */
      it.each(refused)("marks $case invalid", ({ config }) => {
        // Pin the premise: the server would reject each of these.
        expect(safeParseSpendSpikeThresholdConfig(config).ok).toBe(false);

        const { verdict } = preview({
          ruleType: "spend_spike",
          raw: JSON.stringify(config),
        });

        expect(verdict).toBe("Invalid");
      });
    });
  });

  describe("given a rule type that is not spend_spike", () => {
    describe("when the type is one the create call accepts but nothing checks yet", () => {
      /** @scenario "The composer preview says a saveable but unchecked rule type will not fire" */
      it.each(
        ALLOWED_RULE_TYPES.filter((t) => t !== "spend_spike"),
      )("marks %s as saving without firing", (ruleType) => {
        const { verdict, sentence } = preview({ ruleType, raw: "{}" });

        expect(verdict).toBe("Won't fire");
        expect(sentence).toContain(ruleType);
      });
    });

    describe("when the type is one the create call would refuse", () => {
      /** @scenario "The composer preview refuses a rule type the create call would refuse" */
      it.each([
        "spend_spikes",
        "SPEND_SPIKE",
        "",
        "  ",
      ])("marks %j invalid rather than promising it saves", (ruleType) => {
        const { verdict, sentence } = preview({ ruleType, raw: "{}" });

        expect(verdict).toBe("Invalid");
        // The admin gets the same list the server would have answered with.
        for (const allowed of ALLOWED_RULE_TYPES) {
          expect(sentence).toContain(allowed);
        }
      });
    });
  });

  describe("given the template the composer pre-fills", () => {
    describe("when it is read the way the create call reads it", () => {
      /** @scenario "The composer's spend_spike template is exactly what the rule reads" */
      it("parses with no key left over", () => {
        const parsed: unknown = JSON.parse(SPEND_SPIKE_THRESHOLD_TEMPLATE);
        const result = safeParseSpendSpikeThresholdConfig(parsed);

        expect(result.ok).toBe(true);
        // Anything the schema strips is a key the composer offered and the
        // rule never reads.
        expect(result.ok && Object.keys(result.data).sort()).toEqual(
          Object.keys(parsed as Record<string, unknown>).sort(),
        );
      });
    });
  });
});
