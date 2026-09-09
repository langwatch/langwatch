import { createHash } from "node:crypto";
import {
  type LangyCredentialSession,
  type LangyCredentials,
  type LangyMessagePart,
  LANGY_TURN_OVERRIDE_FALLBACK,
} from "@langwatch/langy-contract";
import type { LangyPromptPort } from "./langy-prompt-registry.service.ts";
import { LangyFinalPartsService } from "./langy-final-parts.service.ts";
import {
  LangyGithubPermitPort,
  LangyHarnessPort,
  LangyModelPort,
  LangySessionKeyPort,
  LangyTurnContextPort,
  LangyTurnMetricsPort,
  LangyUiActionSurfacePort,
  type LangyWorkerProbeInput,
  LangyWorkerPort,
} from "../ports/langy-turn-runtime.port.ts";
import type { LangyTurnAccessPort } from "../ports/langy-turn-access.port.ts";
import type { LangyTurnHandoffPort } from "../ports/langy-turn-handoff.port.ts";
import type { LangyTokenBufferPort } from "../ports/langy-token-buffer.port.ts";
import { LangyConversationService } from "./langy-conversation.service.ts";
import { LangyCredentialService } from "./langy-credential.service.ts";
import { LangyMessageRepository } from "../repositories/langy-message.repository.ts";
import { LangyTurnAdmissionRepository } from "../repositories/langy-turn-admission.repository.ts";

export const LANGY_OVERRIDE = LANGY_TURN_OVERRIDE_FALLBACK;

export interface LangyChatMessageInput {
  role: "user" | "assistant" | "system";
  parts: LangyMessagePart[];
}

export interface StartConversationTurnInput {
  projectId: string;
  idempotencyKey: string;
  session: LangyCredentialSession;
  requestedConversationId: string | null;
  adoptConversationId?: boolean;
  messages: LangyChatMessageInput[];
  modelOverride?: string;
  isRetry: boolean;
  turnContext: object;
}

export interface LangyTurnServiceDeps {
  finalParts?: LangyFinalPartsService;
  conversations: LangyConversationService;
  credentials: LangyCredentialService;
  prompts?: LangyPromptPort;
  promptProjectId?: string;
  models: LangyModelPort;
  worker: LangyWorkerPort | null;
  tokenBuffer: LangyTokenBufferPort | null;
  permits: LangyGithubPermitPort;
  harness?: LangyHarnessPort;
  perDayPrCap: number;
  sessionKeys: LangySessionKeyPort;
  context: LangyTurnContextPort;
  uiActionSurface: LangyUiActionSurfacePort;
  metrics: LangyTurnMetricsPort;
  admission: LangyTurnAdmissionRepository;
  accessStore: LangyTurnAccessPort | null;
  handoffStore: LangyTurnHandoffPort | null;
  messages: LangyMessageRepository | null;
}

export type LangyTurnServiceDependencies = LangyTurnServiceDeps & {
  finalParts: LangyFinalPartsService;
};

export type LangyTurnTechnicalPorts = {
  finalParts?: LangyFinalPartsService;
  prompts?: LangyPromptPort;
  promptProjectId?: string;
  models: LangyModelPort;
  worker: LangyWorkerPort | null;
  tokenBuffer: LangyTokenBufferPort | null;
  permits: LangyGithubPermitPort;
  harness?: LangyHarnessPort;
  perDayPrCap: number;
  sessionKeys: LangySessionKeyPort;
  context: LangyTurnContextPort;
  uiActionSurface: LangyUiActionSurfacePort;
  metrics: LangyTurnMetricsPort;
  accessStore: LangyTurnAccessPort | null;
  handoffStore: LangyTurnHandoffPort | null;
};

export const LANGY_USER_MESSAGE_LABEL = "THE USER'S MESSAGE:";

/** The pieces every Langy turn path shares: its identity, its prompt, its probe. */
export class LangyTurnSharedService {
  static create(): LangyTurnSharedService {
    return new LangyTurnSharedService();
  }

  private constructor() {}

  langyTurnIdentity(input: {
    userId: string;
    idempotencyKey: string;
    messages: unknown;
    modelOverride?: string;
  }): { turnId: string; messageId: string } {
    const digest = createHash("sha256")
      .update(input.userId)
      .update("\u0000")
      .update(input.idempotencyKey)
      .update("\u0000")
      .update(JSON.stringify(input.messages))
      .update("\u0000")
      .update(input.modelOverride ?? "")
      .digest("hex")
      .slice(0, 32);

    return { turnId: `langyturn_${digest}`, messageId: `langymsg_${digest}` };
  }

  composeLangyTurnPrompt({
    contextBlock,
    capNote,
    userText,
  }: {
    contextBlock: string | null;
    capNote: string;
    userText: string;
  }): { prompt: string; labelled: boolean } {
    const preamble = [contextBlock, capNote]
      .map((block) => (block ?? "").trim())
      .filter((block) => block.length > 0);
    if (preamble.length === 0) {
      return { prompt: userText, labelled: false };
    }

    return {
      prompt: [...preamble, `${LANGY_USER_MESSAGE_LABEL}\n${userText}`].join("\n\n"),
      labelled: true,
    };
  }

  buildWorkerProbeArgs({
    projectId,
    actorUserId,
    conversationId,
    model,
    credentials,
  }: {
    projectId: string;
    actorUserId: string;
    conversationId: string;
    model: string;
    credentials: LangyCredentials;
  }): LangyWorkerProbeInput {
    return {
      projectId,
      actorUserId,
      conversationId,
      model,
      hasGithubAuth: !!credentials.githubToken,
      ...(credentials.githubRepoScopeKey
        ? { githubRepoScopeKey: credentials.githubRepoScopeKey }
        : {}),
      ...(credentials.egressAllowlist ? { egressAllowlist: credentials.egressAllowlist } : {}),
      ...(credentials.mirrorTier ? { mirrorTier: credentials.mirrorTier } : {}),
      ...(credentials.harness ? { harness: credentials.harness } : {}),
    };
  }

  async reconstructPartialAnswer(
    tokenBuffer: LangyTokenBufferPort,
    { conversationId, turnId }: { conversationId: string; turnId: string },
  ): Promise<string> {
    const { reads } = await tokenBuffer.readTail({ conversationId, turnId });
    let text = "";
    for (const { entry } of reads) {
      if (entry.type === "delta") {
        text += entry.text;
      }
    }

    return text;
  }
}
