/**
 * The upload rows and the dataset page follow normalisation through a read hint, not a poll.
 * Spec: specs/datasets/bulk-dataset-upload.feature
 */
import { describe, expect, it } from "vitest";

import { DATASET_NORMALIZATION_SETTLED_EVENT_TYPE } from "../dataset-normalization.events.ts";
import { datasetTrpc } from "../dataset.trpc.ts";

const hintsOf = (name: "getById" | "getAll") =>
  (datasetTrpc.members[name].invalidatedBy ?? []).map((hint) =>
    typeof hint === "string" ? hint : hint.event,
  );

describe("the dataset reads", () => {
  /** @scenario "A file's row leaves Preparing when its dataset settles, without polling" */
  it("refresh one dataset and the list when a normalisation settles", () => {
    expect(hintsOf("getById")).toContain(DATASET_NORMALIZATION_SETTLED_EVENT_TYPE);
    expect(hintsOf("getAll")).toContain(DATASET_NORMALIZATION_SETTLED_EVENT_TYPE);
  });
});
