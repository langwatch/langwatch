/** Test-only concrete capability access for feature characterization suites. */
export { LangyConversationService } from "./services/langy-conversation.service";
export { LangyMessageService } from "./services/langy-message.service";
export { LangyCredentialService } from "./services/langy-credential.service";
export type {
  LangyCredentialErrorReporter,
  LangyCredentialRuntimeService,
  LangyGithubService,
  LangySessionKeyMintingService,
  LangyVirtualKeyService,
} from "./services/langy-credential.service";
export type { LangySessionKeyService } from "./services/langy-session-key.service";
import type {
  LangyGenerateTitleIntent,
  LangyWorkerDispatchIntent,
} from "./ports/langy-conversation-process.port";
import type { LangyEffectPorts } from "./ports/langy-effect.port";

export interface StubLangyEffectCalls {
  dispatchedTurns: Array<LangyWorkerDispatchIntent & { projectId: string }>;
  titleRequests: Array<LangyGenerateTitleIntent & { projectId: string }>;
}

export function createStubLangyEffectPorts(): {
  ports: LangyEffectPorts;
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
