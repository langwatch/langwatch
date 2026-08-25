import type {
  LangyConversation,
  LangyConversationInput,
  LangyConversationListInput,
  LangyConversationPage,
  LangyCreateConversationInput,
  LangyCredential,
  LangyCredentialInput,
  LangyEgressAllowlist,
  LangyRelayFrame,
  LangyStopTurnInput,
  LangyTurnInput,
} from "@langwatch/langy-contract";

// Deliberately not exported: persistence is an implementation detail of Langy.
export abstract class ConversationRepository {
  abstract list(input: LangyConversationListInput): Promise<LangyConversationPage>;
  abstract tryGet(input: LangyConversationInput): Promise<LangyConversation | null>;
  abstract create(input: LangyCreateConversationInput): Promise<LangyConversation>;
  abstract archive(input: LangyConversationInput): Promise<void>;
}

export abstract class TurnRepository {
  abstract start(
    input: LangyTurnInput,
  ): Promise<{ conversation: LangyConversation; turnId: string }>;
  abstract stop(input: LangyStopTurnInput): Promise<void>;
}

export abstract class MessageRepository {
  abstract list(input: LangyConversationInput): Promise<readonly unknown[]>;
}

export abstract class CredentialRepository {
  abstract resolve(input: LangyCredentialInput): Promise<LangyCredential>;
  abstract tryGetEgressAllowlist(projectId: string): Promise<LangyEgressAllowlist | null>;
  abstract trySetEgressAllowlist(
    projectId: string,
    allowlist: LangyEgressAllowlist | null,
  ): Promise<LangyEgressAllowlist | null>;
}

export abstract class RelayRepository {
  abstract publish(frame: LangyRelayFrame): Promise<void>;
}
