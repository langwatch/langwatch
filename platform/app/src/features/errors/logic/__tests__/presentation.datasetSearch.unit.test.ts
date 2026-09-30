/**
 * The search refusal has to read as being about SEARCH. The registry is keyed by
 * code, so a search that reused the export refusal's code would answer the user
 * with copy about exporting a dataset they were trying to search.
 */
import { describe, expect, it } from "vitest";

import { explainHandledError } from "../presentation";
import type { HandledErrorShape } from "../readHandledError";

const SERVER_MESSAGE =
  "Dataset has 120000 rows, more than the 50000 a single search will read";

const refusal: HandledErrorShape = {
  code: "dataset_too_large_to_search",
  meta: { rowCount: 120_000, maxRows: 50_000 },
  httpStatus: 413,
  fault: "customer",
  tips: [],
  docsUrl: undefined,
  traceId: undefined,
  reasons: [],
};

describe("a search refused because the dataset is too large", () => {
  /** @scenario The refusal has its own words, not the export refusal's */
  it("says the dataset is too large to search, and says nothing about exporting", () => {
    const copy = explainHandledError(refusal);
    const shown = `${copy.title} ${copy.description ?? ""}`;

    expect(copy.title).toMatch(/too large to search/i);
    expect(shown).not.toMatch(/export/i);
  });

  it("never shows the code slug or the server's own message", () => {
    const copy = explainHandledError(refusal);
    const shown = `${copy.title} ${copy.description ?? ""}`;

    expect(shown).not.toContain("dataset_too_large_to_search");
    expect(shown).not.toContain(SERVER_MESSAGE);
  });
});
