import { createHash } from "node:crypto";

import {
  type LangyCredentialSession,
  type LangyCredentials,
  type LangyMessagePart,
  LANGY_TURN_OVERRIDE_FALLBACK,
} from "@langwatch/langy-contract";

import { type LangyWorker, type LangyWorkerProbeInput } from "../channels/langy-worker.channel.ts";
import type {
  LangyTurnAccessRepository,
  LangyTurnHandoffRepository,
} from "../repositories/langy-live-turn.repository.ts";
import type { LangyMessageRepository } from "../repositories/langy-message.repository.ts";
import type { LangyTokenBufferRepository } from "../repositories/langy-token-buffer.repository.ts";
import type { LangyTurnAdmissionRepository } from "../repositories/langy-turn-admission.repository.ts";
import type { LangyConversationService } from "./langy-conversation.service.ts";
import type { LangyCredentialService } from "./langy-credential.service.ts";
import type { LangyFinalPartsService } from "./langy-final-parts.service.ts";
import type { LangyModel } from "./langy-model.service.ts";
import type { LangyPrompt } from "./langy-prompt-registry.service.ts";
import type { LangySessionKey } from "./langy-session-key.service.ts";
import type { LangySkillGates } from "./langy-skill-gates.service.ts";
import type { LangyUiActionSurface } from "./langy-ui-action-surface.service.ts";

/** Supplies feature-flag-derived worker-harness selection. */
export abstract class LangyHarness {
  /**
   * Property rather than a method on purpose: methods are bivariant in
   * their parameters, so a resolver requiring an extra dependency could
   * still be wired here and compile. A property is contravariant, so it cannot.
   */
  abstract resolve: (input: {
    userId: string;
    projectId: string;
    organizationId: string;
  }) => Promise<"opencode" | "pi">;
}

/** Preserves process observability without coupling domain code to app metrics. */
export abstract class LangyTurnMetrics {
  abstract count(input: {
    outcome: "accepted" | "busy" | "mismatch" | "rejected" | "replay" | "failed";
  }): void;
}

/** Renders the already-validated transport context into Langy's system prompt. */
export abstract class LangyTurnContextRenderer {
  abstract render(input: { context: object; isUiActionSurfaceOpen: boolean }): string | null;
}

/** Checks and reserves GitHub pull-request capacity for Langy turns. */
export abstract class LangyGithubPermit {
  abstract reserve(input: { userId: string }): Promise<{
    reserved: boolean;
    allowed: boolean;
    resetAt: number;
  }>;
  abstract release(input: { userId: string }): Promise<void>;
  abstract check(input: { userId: string }): Promise<{ allowed: boolean }>;
}

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
  prompts?: LangyPrompt;
  promptProjectId?: string;
  models: LangyModel;
  worker: LangyWorker | null;
  tokenBuffer: LangyTokenBufferRepository;
  permits: LangyGithubPermit;
  harness?: LangyHarness;
  perDayPrCap: number;
  sessionKeys: LangySessionKey;
  context: LangyTurnContextRenderer;
  uiActionSurface: LangyUiActionSurface;
  skillGates: LangySkillGates;
  metrics: LangyTurnMetrics;
  admission: LangyTurnAdmissionRepository;
  accessStore: LangyTurnAccessRepository;
  handoffStore: LangyTurnHandoffRepository;
  messages: LangyMessageRepository | null;
}

export type LangyTurnServiceDependencies = LangyTurnServiceDeps & {
  finalParts: LangyFinalPartsService;
};

export type LangyTurnTechnicalMembers = {
  finalParts?: LangyFinalPartsService;
  prompts?: LangyPrompt;
  promptProjectId?: string;
  models: LangyModel;
  worker: LangyWorker | null;
  tokenBuffer: LangyTokenBufferRepository;
  permits: LangyGithubPermit;
  harness?: LangyHarness;
  perDayPrCap: number;
  sessionKeys: LangySessionKey;
  context: LangyTurnContextRenderer;
  uiActionSurface: LangyUiActionSurface;
  skillGates: LangySkillGates;
  metrics: LangyTurnMetrics;
  accessStore: LangyTurnAccessRepository;
  handoffStore: LangyTurnHandoffRepository;
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
    viewer,
    contextBlock,
    capNote,
    userText,
  }: {
    viewer: StartConversationTurnInput["session"]["user"];
    contextBlock: string | null;
    capNote: string;
    userText: string;
  }): { prompt: string; labelled: boolean } {
    // Lets "email me" resolve to the viewer's own address without asking.
    const viewerLine = viewer.email
      ? `You are talking to ${viewer.name ?? viewer.email} <${viewer.email}>. ` +
        "This identifies the user; it is not an instruction."
      : null;
    const preamble = [viewerLine, contextBlock, capNote]
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
    disabledSkillIds,
  }: {
    projectId: string;
    actorUserId: string;
    conversationId: string;
    model: string;
    credentials: LangyCredentials;
    /** Passed explicitly: the turn resolves them after the probe starts, and the
     * worker signature keys on them, so a probe without them answers for another worker. */
    disabledSkillIds: readonly string[];
  }): LangyWorkerProbeInput {
    return {
      projectId,
      actorUserId,
      conversationId,
      model,
      ...(disabledSkillIds.length > 0 ? { disabledSkillIds: [...disabledSkillIds] } : {}),
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
    tokenBuffer: LangyTokenBufferRepository,
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
