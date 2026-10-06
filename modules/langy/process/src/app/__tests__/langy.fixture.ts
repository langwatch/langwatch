/** Test-only concrete capability access for feature characterization suites. */

import type {
  LangyGenerateTitleIntent,
  LangyWorkerDispatchIntent,
} from "../../eventing/langy-conversation-process.schemas.ts";
import type { LangyIntentEffects } from "../../eventing/langy-conversation.intent.ts";

export interface StubLangyEffectCalls {
  dispatchedTurns: (LangyWorkerDispatchIntent & { projectId: string })[];
  titleRequests: (LangyGenerateTitleIntent & { projectId: string })[];
}

export function createStubLangyEffectPorts(): {
  ports: LangyIntentEffects;
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
