import type { LangyDatabaseRepositories } from "../langy-repositories.registry.ts";
import type { LangyDatabase } from "./langy-database.mapper.ts";
import { PrismaLangyConversationProjectionRepository } from "./prisma.langy-conversation-projection.repository.ts";
import { PrismaLangyConversationTurnProjectionRepository } from "./prisma.langy-conversation-turn-projection.repository.ts";
import { PrismaLangyConversationRepository } from "./prisma.langy-conversation.repository.ts";
import { PrismaLangyCredentialRepository } from "./prisma.langy-credential.repository.ts";
import { PrismaLangyMessageProjectionRepository } from "./prisma.langy-message-projection.repository.ts";
import { PrismaLangyMessageRepository } from "./prisma.langy-message.repository.ts";
import { PrismaLangySessionKeyRepository } from "./prisma.langy-session-key.repository.ts";
import { PrismaLangyTurnAdmissionRepository } from "./prisma.langy-turn-admission.repository.ts";

/** Every row langy keeps in its own Postgres tables, over one database. */
export class PrismaLangyRepositories {
  static create(database: LangyDatabase): LangyDatabaseRepositories {
    return {
      conversations: PrismaLangyConversationRepository.create(database),
      messages: PrismaLangyMessageRepository.create(database),
      credentials: PrismaLangyCredentialRepository.create(database),
      admission: PrismaLangyTurnAdmissionRepository.create(database),
      conversationState: PrismaLangyConversationProjectionRepository.create(database),
      conversationTurnState: PrismaLangyConversationTurnProjectionRepository.create(database),
      messageStorage: PrismaLangyMessageProjectionRepository.create(database),
      sessionKeys: PrismaLangySessionKeyRepository.create(database),
    };
  }
}
