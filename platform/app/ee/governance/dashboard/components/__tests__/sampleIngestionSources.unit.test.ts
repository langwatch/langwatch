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
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */
import { describe, expect, it } from "vitest";

import {
  modeForSourceType,
  offeredSourceTypeOptions,
  SOURCE_TYPE_OPTIONS,
  type SourceType,
} from "../ingestionSourceCatalog";
import { SAMPLE_INGESTION_SOURCES } from "../sampleIngestionSources";

describe("given the Sources tab in sample mode", () => {
  describe("when the sample rows are worked out", () => {
    /** @scenario "Sample sources are the connectors the product offers, named as the menu names them" */
    it("shows one row per offered source type, under that type's catalog name", () => {
      const offered = offeredSourceTypeOptions();
      // Guards the assertion below against passing vacuously: an empty
      // catalog would satisfy "every name is a catalog name" trivially.
      expect(offered.length).toBeGreaterThan(0);

      expect(
        SAMPLE_INGESTION_SOURCES.map((source) => source.sourceType),
      ).toEqual(offered.map((option) => option.value));
      expect(SAMPLE_INGESTION_SOURCES.map((source) => source.name)).toEqual(
        offered.map((option) => option.label),
      );
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

    /** @scenario "Sample sources are the connectors the product offers, named as the menu names them" */
    it("still invents the instance: health, arrival times and cadence vary across the fleet", () => {
      // The part sample data is allowed to make up. A fleet where every row
      // read the same would be a repeat of the menu rather than a preview of
      // a populated table.
      expect(
        new Set(SAMPLE_INGESTION_SOURCES.map((source) => source.status)).size,
      ).toBeGreaterThan(1);
      expect(
        SAMPLE_INGESTION_SOURCES.some((source) => source.errorCount > 0),
      ).toBe(true);
      expect(
        SAMPLE_INGESTION_SOURCES.some((source) => source.lastEventAt === null),
      ).toBe(true);
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
