import type { LangWatchQLCaller, LangWatchQLProtections } from "@langwatch/analytics-contract";
import {
  InstantEvalNotEnabledError,
  InstantEvalRunNotFoundError,
} from "@langwatch/instant-eval-contract";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { InstantEvalRunRow } from "../../repositories/instant-eval-run.repository.ts";
import { InstantEvalRunContextService } from "../instant-eval-run-context.service.ts";

/** A member who may see everything: what the run context carries through. */
const PROTECTIONS: LangWatchQLProtections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

function contextService({
  row,
  hasDeploymentIdentity,
}: {
  row: InstantEvalRunRow | null;
  hasDeploymentIdentity: boolean;
}): InstantEvalRunContextService {
  return InstantEvalRunContextService.create({
    runs: { findById: () => Promise.resolve(row) },
    peers: {
      findProjectCaller: ({ projectId }): Promise<LangWatchQLCaller> =>
        Promise.resolve({ id: projectId, lwqlKey: "key-1" }),
      resolveProjectProtections: () => Promise.resolve(PROTECTIONS),
      isQueryIdentityAvailable: () => hasDeploymentIdentity,
    },
  });
}

const RUN: InstantEvalRunRow = {
  id: "run-1",
  projectId: "project-1",
  name: null,
  sql: "select 1",
  parameters: {},
  questions: [],
  plan: [],
  rowLimit: 100,
  status: "RUNNING",
  total: null,
  progress: 0,
  matched: null,
  matchedByQuestion: {},
  failed: 0,
  skipped: 0,
  tokens: 0,
  costUsd: 0,
  priceUsd: 0,
  error: null,
  createdAt: nowInstant(),
  updatedAt: nowInstant(),
  startedAt: null,
  finishedAt: null,
  occurredAt: null,
  acceptedAt: null,
  lastEventId: null,
  projectionVersion: null,
};

describe("loading the run a step is a step of", () => {
  /** @scenario "A run whose deployment has no query identity says so, not that the run is gone" */
  it("names the configuration gap rather than reporting the run as missing", async () => {
    const service = contextService({ row: RUN, hasDeploymentIdentity: false });

    const failure = await service
      .load({ projectId: "project-1", runId: "run-1" })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(InstantEvalNotEnabledError);
    expect(failure).not.toBeInstanceOf(InstantEvalRunNotFoundError);
  });

  it("reports a run the project does not hold as missing", async () => {
    const service = contextService({ row: null, hasDeploymentIdentity: true });

    await expect(service.load({ projectId: "project-1", runId: "run-1" })).rejects.toBeInstanceOf(
      InstantEvalRunNotFoundError,
    );
  });
});
