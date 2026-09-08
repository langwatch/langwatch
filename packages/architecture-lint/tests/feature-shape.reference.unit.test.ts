import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { collectFeatureShapeFindings } from "../src/feature-shape.ts";
import { discoverClassifiedPackages } from "../src/workspace.ts";

const root = resolve(import.meta.dirname, "../../..");
const REFERENCE_FEATURE = "annotation";
/** The api's refusing twin is composition debt outside the packages; the baseline lists it. */
const COMPOSITION_KINDS = new Set(["refusing-composition"]);

describe("the reference feature", () => {
  describe("when the real workspace is measured against the annotation shape", () => {
    /** @scenario "The reference feature carries no legacy piece" */
    it("carries no legacy piece in its contract, server or web package", () => {
      const discovery = discoverClassifiedPackages(root);
      const findings = collectFeatureShapeFindings(
        root,
        discovery.catalogue,
        discovery.packages,
      ).filter(
        (finding) => finding.feature === REFERENCE_FEATURE && !COMPOSITION_KINDS.has(finding.kind),
      );

      expect(findings).toEqual([]);
    });
  });
});
