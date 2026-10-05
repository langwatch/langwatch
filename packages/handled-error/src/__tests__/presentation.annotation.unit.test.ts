import { APP_ERROR_CODES } from "@langwatch/handled-error/app-codes";
import { explainHandledError } from "@langwatch/handled-error/presentation";
import type { HandledErrorShape } from "@langwatch/handled-error/read-handled-error";
/**
 * Deleting an annotation that is already gone answers annotation_not_found. A
 * customer reads registry copy for it, never the server message or the slug.
 */
import { describe, expect, it } from "vitest";

const SERVER_MESSAGE = "Annotation ann_missing was not found.";

const refusal: HandledErrorShape = {
  code: "annotation_not_found",
  meta: { annotationId: "ann_missing" },
  httpStatus: 404,
  fault: "customer",
  retryable: false,
  tips: [],
  docsUrl: void 0,
  traceId: void 0,
  reasons: [],
};

describe("an annotation that no longer exists", () => {
  it("is a registered app code", () => {
    expect(APP_ERROR_CODES).toContain("annotation_not_found");
  });

  it("says the annotation was not found and how to recover", () => {
    const copy = explainHandledError(refusal);

    expect(copy.title).toBe("Annotation not found");
    expect(copy.description).toMatch(/reload/i);
  });

  it("never shows the code slug or the server's own message", () => {
    const copy = explainHandledError(refusal);
    const shown = `${copy.title} ${copy.description ?? ""}`;

    expect(shown).not.toContain("annotation_not_found");
    expect(shown).not.toContain(SERVER_MESSAGE);
  });
});
