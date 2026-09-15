/** Test-only concrete capability access for feature characterization suites. */

export type {
  LangyCredentialErrorReporter,
  LangyCredentialRuntimeService,
  LangyGithubService,
  LangySessionKeyMintingService,
  LangyVirtualKeyService,
} from "./services/langy-credential.service.ts";
export type { LangySessionKeyService } from "./services/langy-session-key.service.ts";
import type {
  LangyGenerateTitleIntent,
  LangyWorkerDispatchIntent,
} from "./app/langy.members.ts";
import type { LangyEffectMembers } from "./app/langy.members.ts";

export interface StubLangyEffectCalls {
  dispatchedTurns: Array<LangyWorkerDispatchIntent & { projectId: string }>;
  titleRequests: Array<LangyGenerateTitleIntent & { projectId: string }>;
}

export function createStubLangyEffectPorts(): {
  ports: LangyEffectMembers;
  calls: StubLangyEffectCalls;
} {
  const calls: StubLangyEffectCalls = {
    dispatchedTurns: [],
    titleRequests: [],
  };
  return {
    calls,
    ports: {
      workerDispatch: {
        async dispatchTurn(params) {
          calls.dispatchedTurns.push(params);
        },
      },
      titleGeneration: {
        async generateTitle(params) {
          calls.titleRequests.push(params);
        },
      },
    },
  };
}
