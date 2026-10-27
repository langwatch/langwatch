import { describe, expect, it } from "vitest";

import {
  changedColumnNames,
  changedRowLabel,
  formatVersionCellValue,
  restoreBlockedReason,
  restoredVersionNotice,
  rowCountLabel,
  savedVersionNotice,
  versionAuthorLabel,
  versionColumnNames,
  versionTitle,
  versionTriggerLabel,
  versionUsageLabel,
} from "../dataset-version-history.ts";

describe("versionTitle", () => {
  it("names the version by number, adding its name when it has one", () => {
    expect(versionTitle({ version: 3, name: null })).toBe("Version 3");
    expect(versionTitle({ version: 3, name: "Before relabel" })).toBe("Version 3 · Before relabel");
  });
});

describe("versionTriggerLabel", () => {
  it("says what saved each kind of version", () => {
    expect(versionTriggerLabel({ trigger: "autosave", restoredFromVersion: null })).toBe(
      "Autosaved",
    );
    expect(versionTriggerLabel({ trigger: "manual", restoredFromVersion: null })).toBe(
      "Saved by hand",
    );
    expect(versionTriggerLabel({ trigger: "experiment_run", restoredFromVersion: null })).toBe(
      "Experiment run",
    );
    expect(versionTriggerLabel({ trigger: "initial", restoredFromVersion: null })).toBe(
      "First version",
    );
  });

  it("names the version a restore came from", () => {
    expect(versionTriggerLabel({ trigger: "restore", restoredFromVersion: 1 })).toBe(
      "Restored from version 1",
    );
    expect(versionTriggerLabel({ trigger: "restore", restoredFromVersion: null })).toBe("Restored");
  });
});

describe("versionAuthorLabel", () => {
  it("reads the reader's own version as theirs", () => {
    expect(
      versionAuthorLabel({
        authorKind: "user",
        authorId: "user-1",
        currentUserId: "user-1",
        authorName: null,
      }),
    ).toBe("You");
  });

  it("names another member by the name the server resolved", () => {
    expect(
      versionAuthorLabel({
        authorKind: "user",
        authorId: "user-2",
        currentUserId: "user-1",
        authorName: "Ada Lovelace",
      }),
    ).toBe("Ada Lovelace");
    expect(
      versionAuthorLabel({
        authorKind: "user",
        authorId: "user-9",
        currentUserId: "user-1",
        authorName: null,
      }),
    ).toBe("A team member");
  });

  it("names API keys and the platform", () => {
    expect(
      versionAuthorLabel({
        authorKind: "api_key",
        authorId: "key-1",
        currentUserId: "user-1",
        authorName: null,
      }),
    ).toBe("API key");
    expect(
      versionAuthorLabel({
        authorKind: "system",
        authorId: null,
        currentUserId: "user-1",
        authorName: null,
      }),
    ).toBe("System");
    expect(
      versionAuthorLabel({
        authorKind: null,
        authorId: null,
        currentUserId: "user-1",
        authorName: null,
      }),
    ).toBe("System");
  });
});

describe("versionUsageLabel", () => {
  it("counts the runs that read a version, and otherwise says when it is kept", () => {
    expect(versionUsageLabel({ pinned: true, runCount: 1 })).toBe("Used by 1 run");
    expect(versionUsageLabel({ pinned: true, runCount: 4 })).toBe("Used by 4 runs");
    expect(versionUsageLabel({ pinned: true, runCount: 0 })).toBe("Kept for an experiment");
    expect(versionUsageLabel({ pinned: false, runCount: 0 })).toBeNull();
  });
});

describe("rowCountLabel", () => {
  it("counts rows in the singular and plural", () => {
    expect(rowCountLabel(1)).toBe("1 row");
    expect(rowCountLabel(1200)).toBe("1,200 rows");
  });
});

describe("restoreBlockedReason", () => {
  const base = { version: 1, latestVersion: 2, restoreSupported: true, canUpdate: true };

  it("allows restoring an older version", () => {
    expect(restoreBlockedReason(base)).toBeNull();
  });

  it("explains why the latest version, a legacy dataset or a reader cannot restore", () => {
    expect(restoreBlockedReason({ ...base, version: 2 })).toBe("This is the latest version.");
    expect(restoreBlockedReason({ ...base, restoreSupported: false })).toMatch(/single-file/);
    expect(restoreBlockedReason({ ...base, canUpdate: false })).toMatch(/permission/);
  });
});

describe("versionColumnNames", () => {
  it("keeps the saved column order and appends keys only the rows hold", () => {
    expect(
      versionColumnNames({
        columns: [{ name: "input" }, { name: "output" }],
        rows: [{ id: "r1", entry: { output: "b", input: "a", extra: 1 } }],
      }),
    ).toEqual(["input", "output", "extra"]);
  });
});

describe("formatVersionCellValue", () => {
  it("prints text as is, scalars as text, objects as JSON and empties as nothing", () => {
    expect(formatVersionCellValue("hello")).toBe("hello");
    expect(formatVersionCellValue(3)).toBe("3");
    expect(formatVersionCellValue(false)).toBe("false");
    expect(formatVersionCellValue({ a: 1 })).toBe('{"a":1}');
    expect(formatVersionCellValue(null)).toBe("");
    expect(formatVersionCellValue(undefined)).toBe("");
  });
});

describe("changedColumnNames", () => {
  it("lists the columns whose values differ, including ones added or dropped", () => {
    expect(
      changedColumnNames({
        id: "r1",
        before: { input: "a", output: "old", gone: "x" },
        after: { input: "a", output: "new", fresh: "y" },
      }),
    ).toEqual(["output", "gone", "fresh"]);
  });
});

describe("changedRowLabel", () => {
  it("names a changed row by its first value, on one line and cut when long", () => {
    expect(changedRowLabel({ id: "r1", before: {}, after: { input: "what is\nlangwatch" } })).toBe(
      "what is langwatch",
    );
    expect(
      changedRowLabel({ id: "r1", before: {}, after: { input: "x".repeat(80) } }),
    ).toHaveLength(60);
    expect(changedRowLabel({ id: "r1", before: { input: "old" }, after: { input: "" } })).toBe(
      "old",
    );
    expect(changedRowLabel({ id: "r1", before: {}, after: {} })).toBe("Row with no values");
  });
});

describe("savedVersionNotice", () => {
  it("confirms a new version", () => {
    expect(savedVersionNotice({ saved: { version: 3, name: null }, previousLatest: 2 })).toEqual({
      title: "Saved version 3",
    });
  });

  it("says when the save only named the latest version or found nothing to save", () => {
    expect(
      savedVersionNotice({ saved: { version: 2, name: "Baseline" }, previousLatest: 2 }).title,
    ).toBe("Named version 2");
    expect(savedVersionNotice({ saved: { version: 2, name: null }, previousLatest: 2 })).toEqual({
      title: "No changes since version 2",
    });
  });
});

describe("restoredVersionNotice", () => {
  it("names the version restored and the version it wrote", () => {
    expect(
      restoredVersionNotice({ version: 1, restored: { changed: true, version: { version: 3 } } }),
    ).toEqual({ title: "Restored version 1", description: "Saved as version 3." });
  });

  it("says nothing was restored when the dataset already matches", () => {
    expect(
      restoredVersionNotice({ version: 2, restored: { changed: false, version: { version: 2 } } })
        .title,
    ).toBe("Nothing to restore");
  });
});
