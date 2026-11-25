/**
 * The notes a run adds, as a card's (i) line shows them: plain words, never a parameter name.
 * @see modules/dashboard/specs/dashboards-v2.feature AC213d
 */
import { describe, expect, it } from "vitest";

import { runNotes } from "../langwatch-ql-run-notes.rules.ts";

const INTERNAL_TERMS = /\b(origins?|traces?|spans?|buckets?|LangWatchQL|LWQL)\b|\{|\}/i;

describe("given a run the server limited in every way it can", () => {
  const notes = runNotes({
    memberWindows: [{ projectId: "project-1", from: 1_700_000_000_000 }],
    sources: ["application"],
    followsSources: false,
    granularity: { granularitySeconds: 3600, coarsenedFromSeconds: 60 },
  });

  /** @scenario "AC213d Diagnostics: the (i) line speaks plain words, never a parameter name" */
  it("says each limit with no placeholder and no request-internal term", () => {
    expect(notes.map((note) => note.code)).toEqual([
      "SHARE_WINDOW_LIMITED",
      "SOURCES_IGNORED",
      "GRANULARITY_COARSENED",
    ]);
    expect(notes.filter((note) => INTERNAL_TERMS.test(note.message))).toEqual([]);
  });

  /** @scenario "AC213d Diagnostics: the (i) line speaks plain words, never a parameter name" */
  it("says the sources were ignored in the words a card shows", () => {
    expect(notes.find((note) => note.code === "SOURCES_IGNORED")?.message).toBe(
      "This query doesn't read the sources you picked, so they change nothing it counts.",
    );
  });
});
