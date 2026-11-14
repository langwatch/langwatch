/**
 * The card run carries the projects a query stores, and none when it stores none.
 * @see modules/dashboard/specs/dashboards-v2.feature AC206, AC207b
 */
import type { LangWatchQLQueryResult } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { createLangWatchQLExecute } from "../lwql-execute.ts";

const RESULT = {} as LangWatchQLQueryResult;

async function sentFor(request: { projects?: readonly string[] }) {
  const sent: Record<string, unknown>[] = [];
  const execute = createLangWatchQLExecute({
    transport: {
      mutate: async (input) => {
        sent.push({ ...input });
        return RESULT;
      },
    },
    projectId: "board",
  });
  await execute({ sql: "SELECT 1", ...request }, { signal: new AbortController().signal });

  return sent[0];
}

describe("given a card run", () => {
  /** @scenario "AC207b Project: a query saved with picked projects reads only those projects, in the order picked" */
  it("sends the projects the query stores, in the order stored", async () => {
    expect(await sentFor({ projects: ["B", "A"] })).toMatchObject({
      projectId: "board",
      projects: ["B", "A"],
    });
  });

  /** @scenario "AC206 Project: a card reads the board's project unless its query names others" */
  it("sends none when the query stores none, so the board's project is read", async () => {
    expect(await sentFor({})).not.toHaveProperty("projects");
  });
});
