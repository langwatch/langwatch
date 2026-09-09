// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The Sources tab in sample mode names real connectors, and only real ones.
 *
 * The rows were once built from the sample TOOL cards, which meant the table
 * showed a "ChatGPT Enterprise" source and a "Custom Agents" source. Both are
 * names the source catalog has never held, so a reader who turned the samples
 * off and opened Add source found neither. These assertions are the guard: the
 * sample's names come out of the same list the menu reads, and nothing else is
 * allowed to name a connector.
 *
 * The sample is a strict SUBSET of that list, not a copy of it: a type may be
 * held back from the mock-up while staying on offer. Both directions are
 * pinned below, because each fails a different way — a sample wider than the
 * menu previews a connector nobody can create, and a sample that silently
 * re-widens puts back a row the product owner asked to have removed.
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */
import { describe, expect, it } from "vitest";
import { sourceBadge } from "../../logic/sourceHealthDisplay";
import {
  modeForSourceType,
  offeredSourceTypeOptions,
  SOURCE_TYPE_OPTIONS,
  type SourceType,
  sampleSourceTypeOptions,
} from "../ingestionSourceCatalog";
import { SAMPLE_INGESTION_SOURCES } from "../sampleIngestionSources";

describe("given the Sources tab in sample mode", () => {
  describe("when the sample rows are worked out", () => {
    /** @scenario "Sample sources are the connectors the product offers, named as the menu names them" */
    it("shows one row per sampled source type, under that type's catalog name", () => {
      const sampled = sampleSourceTypeOptions();
      // Guards the assertion below against passing vacuously: an empty
      // catalog would satisfy "every name is a catalog name" trivially.
      expect(sampled.length).toBeGreaterThan(0);

      expect(
        SAMPLE_INGESTION_SOURCES.map((source) => source.sourceType),
      ).toEqual(sampled.map((option) => option.value));
      expect(SAMPLE_INGESTION_SOURCES.map((source) => source.name)).toEqual(
        sampled.map((option) => option.label),
      );
    });

    /** @scenario "Sample sources are the connectors the product offers, named as the menu names them" */
    it("shows only types the Add source menu offers", () => {
      // The one direction the two lists may differ in. The sample may be
      // narrower than the menu; it may never be wider, or it would preview a
      // connector nobody can go on to create.
      const offered = new Set(
        offeredSourceTypeOptions().map((option) => option.value),
      );
      expect(SAMPLE_INGESTION_SOURCES.length).toBeGreaterThan(0);

      for (const source of SAMPLE_INGESTION_SOURCES) {
        expect(offered).toContain(source.sourceType);
      }
    });

    /** @scenario "Sample sources are the connectors the product offers, named as the menu names them" */
    it("names no connector the catalog does not, and none of the retired sample names", () => {
      const catalogNames = new Set(
        SOURCE_TYPE_OPTIONS.map((option) => option.label),
      );
      for (const source of SAMPLE_INGESTION_SOURCES) {
        expect(catalogNames).toContain(source.name);
      }
      // The three names the product owner actually read off the screen.
      const invented = ["ChatGPT Enterprise", "Custom Agents", "Claude Cowork"];
      for (const name of invented) {
        expect(catalogNames.has(name)).toBe(false);
        expect(
          SAMPLE_INGESTION_SOURCES.some((source) => source.name === name),
        ).toBe(false);
      }
    });

    /** @scenario "A retired source type is offered as a sample no more than it is offered for real" */
    it("leaves out a retired source type", () => {
      const retired = SOURCE_TYPE_OPTIONS.filter((option) => option.deprecated);
      // Same self-check: with nothing retired this would prove nothing.
      expect(retired.length).toBeGreaterThan(0);

      for (const option of retired) {
        expect(
          SAMPLE_INGESTION_SOURCES.some(
            (source) => source.sourceType === option.value,
          ),
        ).toBe(false);
      }
    });

    /** @scenario "A type held back from the sample is still offered in the Add source menu" */
    it("holds Cowork back from the sample without withdrawing it from the menu", () => {
      const cowork = SOURCE_TYPE_OPTIONS.find(
        (option) => option.value === "claude_cowork",
      );
      // If the entry is gone entirely this test must fail loudly rather than
      // pass over an undefined: the product decision was to keep the type.
      expect(cowork).toBeDefined();

      // Held back from the mock-up...
      expect(cowork?.omitFromSample).toBe(true);
      expect(
        SAMPLE_INGESTION_SOURCES.some(
          (source) => source.sourceType === "claude_cowork",
        ),
      ).toBe(false);

      // ...and still a live, pickable connector. The owner asked for it out of
      // the sample, explicitly NOT deleted or retired, so dropping the flag or
      // adding `deprecated` both have to break something.
      expect(cowork?.deprecated).toBeUndefined();
      expect(
        offeredSourceTypeOptions().some(
          (option) => option.value === "claude_cowork",
        ),
      ).toBe(true);
    });

    /** @scenario "Sample sources are the connectors the product offers, named as the menu names them" */
    it("still invents the instance: every badge the table can draw is on screen", () => {
      // The part sample data is allowed to make up, and the reason the cycle
      // exists at all: a fleet where every row read the same would be a repeat
      // of the menu rather than a preview of a populated table.
      //
      // Asserted through `sourceBadge` rather than over raw statuses because
      // the states are cycled BY POSITION over the catalog. Holding a type
      // back shifts every row after it, and the shift is silent — the badge
      // that would go missing is "Not pulling", which needs its state to land
      // on a PULL source, since a push row has its error count zeroed. This
      // fails loudly if the next held-back type costs the table a badge.
      const drawn = new Set(
        SAMPLE_INGESTION_SOURCES.map(
          (source) =>
            sourceBadge({
              status: source.status,
              errorCount: source.errorCount,
            }).label,
        ),
      );

      expect(drawn).toEqual(
        new Set(["Active", "Not pulling", "Awaiting first event", "Disabled"]),
      );
      // Arrival times spread rather than clustering on one timestamp. Not
      // asserted as all-distinct: there are more rows than states, so the
      // cycle wraps and the last rows legitimately repeat the first few.
      const arrivals = SAMPLE_INGESTION_SOURCES.map(
        (source) => source.lastEventAt?.getTime() ?? null,
      );
      expect(
        new Set(arrivals.filter((time) => time !== null)).size,
      ).toBeGreaterThan(1);
      expect(arrivals.some((time) => time === null)).toBe(true);
    });

    /** @scenario "Sample sources are the connectors the product offers, named as the menu names them" */
    it("invents no state the product cannot reach: a push source never counts pull failures", () => {
      const pushRows = SAMPLE_INGESTION_SOURCES.filter(
        (source) =>
          modeForSourceType({
            sourceType: source.sourceType as SourceType,
          }) === "push",
      );
      // Without this the assertion below would hold over an empty set.
      expect(pushRows.length).toBeGreaterThan(0);

      for (const source of pushRows) {
        // `errorCount` counts consecutive PULL failures — only the puller
        // worker writes it — so a push row showing "Not pulling" or a polling
        // cadence would be a state no real fleet can produce.
        expect(source.errorCount).toBe(0);
        expect(source.pullSchedule).toBeNull();
      }
    });
  });
});
