/**
 * An inline failure surface has room the toast does not: it lists every tip
 * that still adds something and offers the docs link beside them. What it must
 * never do is repeat itself — a tip saying what the description already said is
 * a second authoring of one remediation, not a second remediation.
 */
import { describe, expect, it } from "vitest";

import { resolveErrorCopy } from "../resolve-error-copy";

const DOCS_URL = "https://docs.langwatch.ai/platform/datasets";

const wire = (error: Record<string, unknown>) => ({ data: { error } });

describe("resolveErrorCopy remediation", () => {
  describe("given a code the registry has no copy for", () => {
    describe("when the server sent tips and a docs link", () => {
      /** @scenario "Remediation reaches the customer when we have nothing better" */
      it("lists every tip and offers the docs link", () => {
        const copy = resolveErrorCopy({
          error: wire({
            code: "dataset_import_stalled",
            httpStatus: 409,
            tips: ["Rotate the key", "Then retry"],
            docsUrl: DOCS_URL,
          }),
          fallbackTitle: "Couldn't import the dataset",
        });

        expect(copy.tips).toEqual(["Rotate the key", "Then retry"]);
        expect(copy.docsUrl).toBe(DOCS_URL);
      });
    });
  });

  describe("given a code the registry describes itself", () => {
    describe("when one tip repeats that description and another adds to it", () => {
      /** @scenario "A tip that repeats our copy is dropped, one that adds to it is kept" */
      it("drops the repeat, keeps the addition, and still offers the docs link", () => {
        const copy = resolveErrorCopy({
          error: wire({
            code: "rate_limited",
            httpStatus: 429,
            tips: ["Slow down for a moment, then try again", "Ask support to raise your quota"],
            docsUrl: DOCS_URL,
          }),
          fallbackTitle: "Couldn't load the traces",
        });

        expect(copy.description).toBe("Slow down for a moment, then try again.");
        expect(copy.tips).toEqual(["Ask support to raise your quota"]);
        expect(copy.docsUrl).toBe(DOCS_URL);
      });
    });
  });
});
