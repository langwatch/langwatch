/**
 * @vitest-environment jsdom
 *
 * The two picture detectors, pinned to the same answer.
 *
 * `datasetImageUrl` travels with the dataset editor and `getImageUrl` with the
 * design system, and both decide whether a cell value is a picture. They are
 * separate because the design system depends on no feature contract; they must
 * still agree, or a picture renders in one grid and not in another. This is
 * where that agreement is checked, because only this package may import both.
 *
 * jsdom because the design system's module is a component file.
 *
 * Spec: specs/datasets/dataset-editor.feature.
 */

import { describe, expect, it } from "vitest";

import { getImageUrl } from "@langwatch/design-system/external-image";
import { datasetImageUrl } from "../dataset-image-url.ts";

const VALUES = [
  "/api/files/proj-1/pic-1",
  "/api/files/proj-1/pic-1 ",
  "![a picture](/api/files/proj-1/pic-1)",
  "[report.pdf](/api/files/proj-1/doc-1)",
  "/api/files/proj-1",
  "/api/files/proj-1/pic-1/extra",
  "/api/files/proj-1/pic 1",
  "https://example.com/a.png",
  "https://example.com/page",
  "data:image/png;base64,AAAA",
  "data:application/pdf;base64,AAAA",
  "just some text",
  "",
];

describe("given a cell value", () => {
  describe("when both picture detectors read it", () => {
    /** @scenario "A stored picture is recognised as a picture wherever a cell is drawn" */
    it("answers the same in the dataset editor and in the design system", () => {
      for (const value of VALUES) {
        expect([value, datasetImageUrl(value)]).toEqual([value, getImageUrl(value)]);
      }
    });
  });

  describe("when it is a stored picture", () => {
    it("names the address the browser should fetch", () => {
      expect(datasetImageUrl("/api/files/proj-1/pic-1")).toBe("/api/files/proj-1/pic-1");
    });
  });
});
