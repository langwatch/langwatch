import { createHash } from "node:crypto";
import {
  type LangyCredentialSession,
  type LangyCredentials,
  type LangyMessagePart,
  LANGY_TURN_OVERRIDE_FALLBACK,
} from "@langwatch/langy-contract";
import type { LangyPromptPort } from "./langy-prompt-registry.service";
import { LangyFinalPartsService } from "./langy-final-parts.service";
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
} from "../ports/langy-turn-runtime.port";
import type { LangyTurnAccessStore } from "../streaming/langy-turn-access";
import type { LangyTurnHandoffStore } from "../streaming/langy-turn-handoff";
import type { LangyTokenBuffer } from "../streaming/langy-token-buffer";
import { LangyConversationService } from "./langy-conversation.service";
import { LangyCredentialService } from "./langy-credential.service";
import { LangyMessageRepository } from "../repositories/langy-message.repository";
import { LangyTurnAdmissionRepository } from "../repositories/langy-turn-admission.repository";

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
  tokenBuffer: LangyTokenBuffer | null;
  permits: LangyGithubPermitPort;
  harness?: LangyHarnessPort;
  perDayPrCap: number;
  sessionKeys: LangySessionKeyPort;
  context: LangyTurnContextPort;
  uiActionSurface: LangyUiActionSurfacePort;
  metrics: LangyTurnMetricsPort;
  admission: LangyTurnAdmissionRepository;
  accessStore: LangyTurnAccessStore | null;
  handoffStore: LangyTurnHandoffStore | null;
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
  tokenBuffer: LangyTokenBuffer | null;
  permits: LangyGithubPermitPort;
  harness?: LangyHarnessPort;
  perDayPrCap: number;
  sessionKeys: LangySessionKeyPort;
  context: LangyTurnContextPort;
  uiActionSurface: LangyUiActionSurfacePort;
  metrics: LangyTurnMetricsPort;
  accessStore: LangyTurnAccessStore | null;
  handoffStore: LangyTurnHandoffStore | null;
};

export function langyTurnIdentity(input: {
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

export const LANGY_USER_MESSAGE_LABEL = "THE USER'S MESSAGE:";

export function composeLangyTurnPrompt({
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
  if (preamble.length === 0) return { prompt: userText, labelled: false };
  return {
    prompt: [...preamble, `${LANGY_USER_MESSAGE_LABEL}\n${userText}`].join("\n\n"),
    labelled: true,
  };
}

export function buildWorkerProbeArgs({
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
    ...(credentials.egressAllowlist
      ? { egressAllowlist: credentials.egressAllowlist }
      : {}),
    ...(credentials.mirrorTier ? { mirrorTier: credentials.mirrorTier } : {}),
    ...(credentials.harness ? { harness: credentials.harness } : {}),
  };
}

export async function reconstructPartialAnswer(
  tokenBuffer: LangyTokenBuffer,
  { conversationId, turnId }: { conversationId: string; turnId: string },
): Promise<string> {
  const { reads } = await tokenBuffer.readTail({ conversationId, turnId });
  let text = "";
  for (const { entry } of reads) {
    if (entry.type === "delta") text += entry.text;
  }
  return text;
}
