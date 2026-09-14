/** Test-only concrete capability access for feature characterization suites. */

/** Prisma repositories for test-only suites that assert against real databases. Reachable
 * only here to keep the port seam: repositories are implementation, not public API. */
export { PrismaLangyConversationRepository } from "./repositories/prisma/prisma.langy-conversation.repository.ts";
export { PrismaLangyConversationProjectionRepository } from "./repositories/prisma/prisma.langy-conversation-projection.repository.ts";
export { PrismaLangyConversationTurnProjectionRepository } from "./repositories/prisma/prisma.langy-conversation-turn-projection.repository.ts";
export { PrismaLangyMessageRepository } from "./repositories/prisma/prisma.langy-message.repository.ts";
export { PrismaLangyMessageProjectionRepository } from "./repositories/prisma/prisma.langy-message-projection.repository.ts";
export { PrismaLangyTurnAdmissionRepository } from "./repositories/prisma/prisma.langy-turn-admission.repository.ts";

export { LangyConversationService } from "./services/langy-conversation.service.ts";
export { LangyMessageService } from "./services/langy-message.service.ts";
export { LangyCredentialService } from "./services/langy-credential.service.ts";
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
