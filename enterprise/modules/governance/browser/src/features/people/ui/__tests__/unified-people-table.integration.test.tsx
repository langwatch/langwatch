/**
 * @vitest-environment jsdom
 * The fixed-layout People table keeps the Person column wide enough to read.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../../testing.tsx";
import type { PeopleRow } from "../../model/people-rows.ts";
import { UnifiedPeopleTable } from "../unified-people-table.tsx";

afterEach(cleanup);

const row: PeopleRow = {
  key: "p1",
  displayName: "Ada Lovelace",
  identifier: "ada@example.com",
  provider: "Databricks",
  status: "matched",
  kind: "Person",
  firstSeenIso: null,
  lastSeenIso: null,
  matchDetail: null,
  evidenceKind: null,
  department: null,
  spendUsd: null,
  requests: null,
  lastActiveIso: null,
  mostUsedTarget: null,
  actor: null,
  linkedUserId: null,
  isMachine: false,
  needsReview: false,
  suspendedReason: null,
};

describe("UnifiedPeopleTable", () => {
  it("gives the Person column a width of its own and renders the name", () => {
    renderWithGovernanceHost(<UnifiedPeopleTable rows={[row]} sourceFor={() => null} />, {
      host: fakeGovernanceHost({ permissions: [] }),
    });

    const header = screen.getByRole("columnheader", { name: "Person" });
    expect(header.getAttribute("class")).toBeTruthy();
    expect(getComputedStyle(header).width).not.toBe("");
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
  });
});
