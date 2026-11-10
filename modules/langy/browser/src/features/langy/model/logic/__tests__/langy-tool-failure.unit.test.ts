/**
 * Whether a failed step needs the reader, so it keeps its card.
 * @see specs/langy/langy-card-taxonomy.feature
 */
import { describe, expect, it } from "vitest";

import { type LangyToolErrorPresentation, readerMustAct } from "../langy-tool-failure.ts";

const presentation = (
  overrides: Partial<LangyToolErrorPresentation>,
): LangyToolErrorPresentation => ({
  title: "Running a command failed",
  message: "A message.",
  ...overrides,
});

describe("readerMustAct", () => {
  /** @scenario "A failure no retry can fix keeps its card" */
  it("is true for a credential failure on a local tool, final or not", () => {
    const failure = presentation({ code: "not_authenticated" });

    expect(readerMustAct({ presentation: failure, toolName: "local_bash" })).toBe(true);
    expect(
      readerMustAct({ presentation: { ...failure, terminal: true }, toolName: "local_bash" }),
    ).toBe(true);
  });

  /** @scenario "A sandbox credential failure folds into the record" */
  it("is false for a credential failure in the sandbox, final or not", () => {
    const failure = presentation({ code: "unauthorized", httpStatus: 401 });

    expect(readerMustAct({ presentation: failure, toolName: "bash" })).toBe(false);
    expect(readerMustAct({ presentation: { ...failure, terminal: true }, toolName: "bash" })).toBe(
      false,
    );
  });

  /** @scenario "A refused access keeps its card even when a retry might work" */
  it("is true for an access-denial code that is not final", () => {
    const failure = presentation({ code: "api_key_permission_denied" });

    expect(readerMustAct({ presentation: failure, toolName: "bash" })).toBe(true);
  });

  /** @scenario "A failure no retry can fix keeps its card" */
  it.each([401, 403])("is true for a final %s", (httpStatus) => {
    const failure = presentation({ code: "something_else", httpStatus, terminal: true });

    expect(readerMustAct({ presentation: failure, toolName: "bash" })).toBe(true);
  });

  /** @scenario "A failure no retry can fix keeps its card" */
  it("is true for a final github-not-connected, whatever its case or padding", () => {
    const failure = presentation({ code: "  Langy_GitHub_Not_Connected ", terminal: true });

    expect(readerMustAct({ presentation: failure, toolName: "bash" })).toBe(true);
  });

  /** @scenario "A not-found probe folds into the record" */
  it("is false for a plain failure that is not final", () => {
    const failure = presentation({ code: "dataset_not_found", httpStatus: 404 });

    expect(readerMustAct({ presentation: failure, toolName: "bash" })).toBe(false);
  });
});
