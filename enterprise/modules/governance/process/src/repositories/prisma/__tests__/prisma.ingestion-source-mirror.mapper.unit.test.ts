// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import {
  buildIngestionSourceMirror,
  type IngestionPullRunStatusData,
} from "../prisma.ingestion-source-mirror.mapper.ts";

const RUN: IngestionPullRunStatusData = {
  Enabled: true,
  Cursor: "cursor-1",
  LastRunOutcome: "completed",
  LastRunEventCount: 3,
  ConsecutiveErrors: 0,
  LastSuccessAt: 1_700_000_000_000,
  LastRunAt: 1_700_000_000_000,
  LastReadThroughAt: 1_700_000_000_000,
  LastRunCompleteness: "complete",
};

describe("given a run status holding both listing HTTP statuses and the withheld person count", () => {
  const AGENTS_STATUS = 429;
  const PEOPLE_STATUS = 503;
  const WITHHELD = 37;
  const heldBack = {
    ...RUN,
    LastAgentsListingStatus: AGENTS_STATUS,
    LastPeopleListingStatus: PEOPLE_STATUS,
    LastPeopleWithheldCount: WITHHELD,
  };

  /** @scenario "The mirror carries no sensitive value onto a customer row" */
  it("carries none of the three values onto the mirror, under any field name", () => {
    const mirror = buildIngestionSourceMirror({ state: heldBack });

    expect(Object.keys(mirror).toSorted()).toEqual([
      "errorCount",
      "lastEventAt",
      "lastReadThroughAt",
      "lastRunCompleteness",
      "lastSuccessAt",
      "pollerCursor",
      "status",
    ]);
    const carried = Object.values(mirror);
    for (const secret of [AGENTS_STATUS, PEOPLE_STATUS, WITHHELD]) {
      expect(carried).not.toContain(secret);
    }
  });
});
