import { AUTHORIZATION_CONDITION_TYPES } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { READ_RESOURCES, type ReadResource } from "../authorized-reads.ts";

/**
 * Braid grants carry `traces:view`, `analytics:view` and `cost:view`, so a read resource that
 * applies `span` windows reads owners' spans. Each resource names every condition type; these
 * guards hold the choices that keep braids inert outside span reads.
 */

const resources = Object.entries(READ_RESOURCES) as [
  ReadResource,
  (typeof READ_RESOURCES)[ReadResource],
][];

const OWNER_REVIEW =
  "A read resource that applies `span` windows shows braided spans from other projects. " +
  "Read ADR-201 §3 (dev/docs/adr/201-braids-show-matching-spans-in-another-projects-traces.md) " +
  "and have the braids owner review the change before updating this list.";

describe("the read resources the fence knows", () => {
  describe("when the resources applying a braid's span windows are listed", () => {
    /** @scenario "Only span reads take a braid's windows, and every read names each window type" */
    it("is exactly spans", () => {
      const applying = resources
        .filter(([, resource]) => resource.windows.span === "applies")
        .map(([name]) => name);

      expect(applying, OWNER_REVIEW).toEqual(["spans"]);
    });
  });

  describe("when each resource's windows are read", () => {
    /** @scenario "Only span reads take a braid's windows, and every read names each window type" */
    it("names every condition type, with no default", () => {
      for (const [name, resource] of resources) {
        expect(
          { name, types: Object.keys(resource.windows).toSorted() },
          `${name} must name how it treats every condition type`,
        ).toEqual({ name, types: [...AUTHORIZATION_CONDITION_TYPES].toSorted() });
      }
    });

    it("applies no log window, which no fence renders yet", () => {
      const applying = resources
        .filter(([, resource]) => resource.windows.log === "applies")
        .map(([name]) => name);

      expect(applying, "the fence renders no log window; add one before a read applies it").toEqual(
        [],
      );
    });
  });
});
