/** Test-only concrete capability access for feature characterization suites. */

/**
 * The Prisma repositories, for suites that assert against a real database.
 *
 * They are reachable only from here on purpose. No feature package exports
 * `./repositories/*`: a repository is an implementation of a port, and letting
 * application code import one directly is how the port stops being the seam.
 * A characterization suite is the one caller with a reason — a projection
 * asserted against an in-memory double asserts the double — so the access is
 * named as test-only here rather than opened to everyone.
 */
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
} from "./app/langy.infrastructure.ts";
import type { LangyEffectPorts } from "./app/langy.infrastructure.ts";

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
