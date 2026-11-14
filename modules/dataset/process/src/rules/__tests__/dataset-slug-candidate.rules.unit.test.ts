/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { datasetSlugCandidate } from "../dataset-selection.rules.ts";

describe("datasetSlugCandidate", () => {
  /** @scenario "A dataset stored with an empty slug gets a slug from its name" */
  it("tries the name's slug first, then numbers it from 2", () => {
    expect(datasetSlugCandidate({ name: "Support Questions", attempt: 1 })).toBe(
      "support-questions",
    );
    expect(datasetSlugCandidate({ name: "Support Questions", attempt: 2 })).toBe(
      "support-questions-2",
    );
  });

  /** @scenario "A dataset stored with an empty slug gets a slug from its name" */
  it("falls back to dataset when the name has no letters or digits", () => {
    expect(datasetSlugCandidate({ name: "", attempt: 1 })).toBe("dataset");
    expect(datasetSlugCandidate({ name: " !! ", attempt: 3 })).toBe("dataset-3");
  });
});
