/**
 * A saved dataset's rows read again, laid under the workbench's unsynced edits.
 * Spec: specs/experiments-v3/dataset-version-pin.feature
 */
import { describe, expect, it } from "vitest";

import { refreshedSavedRecords, sameColumnNames } from "../saved-records-refresh.ts";

const current = [
  { id: "r1", question: "a" },
  { id: "r2", question: "b4" },
  { id: "local", question: "new here" },
];
const fresh = [
  { id: "r1", question: "a-EDITED" },
  { id: "r2", question: "b" },
  { id: "r3", question: "c" },
];

describe("refreshedSavedRecords", () => {
  /** @scenario "An open workbench shows a saved dataset's new rows after it changes elsewhere" */
  it("takes the server's rows when nothing is pending", () => {
    expect(refreshedSavedRecords({ fresh, current, pending: undefined })).toEqual(fresh);
  });

  /** @scenario "An open workbench shows a saved dataset's new rows after it changes elsewhere" */
  it("keeps an unsynced cell, a pending deletion and an unsynced row the server lacks", () => {
    expect(
      refreshedSavedRecords({
        fresh,
        current,
        pending: {
          r2: { question: "mine" },
          r3: { _delete: true },
          local: { question: "new here" },
        },
      }),
    ).toEqual([
      { id: "r1", question: "a-EDITED" },
      { id: "r2", question: "mine" },
      { id: "local", question: "new here" },
    ]);
  });
});

describe("sameColumnNames", () => {
  it("matches the same names in any order and refuses a rename", () => {
    expect(sameColumnNames({ serverColumns: ["b", "a"], workbenchColumns: ["a", "b"] })).toBe(true);
    expect(sameColumnNames({ serverColumns: ["a", "c"], workbenchColumns: ["a", "b"] })).toBe(
      false,
    );
  });
});
