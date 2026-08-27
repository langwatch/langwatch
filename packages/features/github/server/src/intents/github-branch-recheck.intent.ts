import type { ProcessStore } from "@langwatch/eventing";
import type { GithubService } from "@langwatch/github-contract";
import { createLogger } from "@langwatch/observability";

import { GITHUB_BRANCH_RECHECK_PROCESS_NAME } from "../processes/github-branch-recheck.process";

const logger = createLogger("langwatch:github:branch-recheck");
const OUTBOX_ROW_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface GithubBranchRecheckDeps {
  github: GithubService;
  processStore: ProcessStore;
}

export function runGithubBranchRecheck(deps: GithubBranchRecheckDeps) {
  return async (): Promise<void> => {
    const rechecked = await deps.github.recheckDueBranches();
    if (rechecked > 0) {
      logger.info({ rechecked }, "branch recheck tick complete");
    }
  };
}

export function runGithubRetentionPrune(deps: GithubBranchRecheckDeps) {
  return async (): Promise<void> => {
    const startedAt = Date.now();
    const { branchChecks } = await deps.github.pruneStaleBranchLinkage();
    if (branchChecks > 0) {
      logger.info({ branchChecks }, "GitHub branch bookkeeping pruned past the activity horizon");
    }

    try {
      await deps.processStore.deleteDispatchedBefore({
        processName: GITHUB_BRANCH_RECHECK_PROCESS_NAME,
        before: startedAt - OUTBOX_ROW_RETENTION_MS,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ error: message }, "GitHub branch recheck outbox retention failed");
    }
  };
}
