/** Test-only concrete capability access for feature characterization suites. */

import type {
  LangyEffectMembers,
  LangyGenerateTitleIntent,
  LangyWorkerDispatchIntent,
} from "../langy.members.ts";

export interface StubLangyEffectCalls {
  dispatchedTurns: (LangyWorkerDispatchIntent & { projectId: string })[];
  titleRequests: (LangyGenerateTitleIntent & { projectId: string })[];
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
