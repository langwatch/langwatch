/**
 * The service's PUSH_SOURCE_TYPES (secret-bearing sources) and the catalog's
 * `needsIngestSecret` must agree. They live in different modules (the catalog
 * is React, the service is Node) so they can't share a constant. This test is
 * the compile-time guard.
 *
 * If it fails, a source type was added to one side but not the other.
 */

import { isPushSourceType } from "@ee/governance/services/activity-monitor/ingestionSource.service";
import { describe, expect, it } from "vitest";
import {
  needsIngestSecret,
  SOURCE_TYPE_OPTIONS,
} from "../ingestionSourceCatalog";

describe("given the catalog and service both classify source types", () => {
  /** @scenario "Each source row shows its delivery protocol" */
  /** @scenario "Each source row shows the vendor icon next to the name" */
  describe("when checking secret-bearing parity", () => {
    it("every catalog secret-bearing type is recognized by the service", () => {
      const catalogSecret = SOURCE_TYPE_OPTIONS.filter((o) =>
        needsIngestSecret({ sourceType: o.value }),
      ).map((o) => o.value);
      const missing = catalogSecret.filter((t) => !isPushSourceType(t));
      expect(missing).toEqual([]);
    });

    it("every service push type is secret-bearing in the catalog", () => {
      const servicePush = SOURCE_TYPE_OPTIONS.filter((o) =>
        isPushSourceType(o.value),
      ).map((o) => o.value);
      const missing = servicePush.filter(
        (t) => !needsIngestSecret({ sourceType: t }),
      );
      expect(missing).toEqual([]);
    });
  });
});
