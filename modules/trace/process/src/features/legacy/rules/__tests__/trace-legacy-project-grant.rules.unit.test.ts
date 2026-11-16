/**
 * @vitest-environment node
 * @see specs/trace-filter-built-conditions.feature
 */
import { narrowAuthorization } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import {
  aggregateProof,
  braidedProof,
  ownProof,
} from "../../../../__tests__/support/authorization-proofs.fixture.ts";
import { proofGrantsProject } from "../trace-legacy-project-grant.rules.ts";

describe("proofGrantsProject", () => {
  /** @scenario "A legacy read refuses a project its proof does not grant" */
  it("denies a project no grant of the proof names", () => {
    expect(
      proofGrantsProject({ authorization: ownProof({ projectId: "p-a" }), projectId: "p-b" }),
    ).toBe(false);
  });

  it("denies a project the proof reaches only by a braid", () => {
    const authorization = braidedProof({ projectId: "p-a", braids: [{ owner: "p-b" }] });

    expect(proofGrantsProject({ authorization, projectId: "p-b" })).toBe(false);
  });

  it("denies a proof narrowed to another of its projects", () => {
    const authorization = narrowAuthorization({
      authorization: aggregateProof({ projectId: "agg", members: [{ projectId: "p-m", from: 0 }] }),
      projectId: "p-m",
    });

    expect(proofGrantsProject({ authorization, projectId: "agg" })).toBe(false);
  });

  it("grants the proof's own project and a project it shares", () => {
    const authorization = aggregateProof({
      projectId: "agg",
      members: [{ projectId: "p-m", from: 0 }],
    });

    expect(proofGrantsProject({ authorization, projectId: "agg" })).toBe(true);
    expect(proofGrantsProject({ authorization, projectId: "p-m" })).toBe(true);
  });
});
