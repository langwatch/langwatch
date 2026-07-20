import { createOpenAI } from "@ai-sdk/openai";
import { env } from "../../env.mjs";
import { ensureGatewayV1BaseUrl } from "../app-layer/langy/LangyCredentialService";
import { provisionLangyVirtualKey } from "../app-layer/langy/langyVirtualKey";
import { prisma } from "../db";
import { isModelAllowedForFeature } from "./codexRestrictions";

/**
 * The Vercel AI SDK handle for a codex model.
 *
 * Codex has exactly one road: the AI gateway's Responses endpoint (the
 * OAuth session, plan-limit handling and token refresh all live there —
 * see services/aigateway/adapters/providers/codex.go). The tiny assists
 * therefore ride the SAME per-project virtual key the Langy agent uses,
 * through the same pipeline (tracing, rate limits, policy), instead of the
 * nlpgo chat-completions proxy the other providers use — the codex backend
 * has no chat-completions surface at all.
 *
 * Spec: specs/model-providers/codex-account-provider.feature
 */
export async function getCodexVercelAIModel({
  projectId,
  model,
  featureKey,
}: {
  projectId: string;
  model: string;
  featureKey: string;
}) {
  if (!isModelAllowedForFeature({ modelId: model, featureKey })) {
    throw new Error(
      `"${model}" serves the coding-assistant surfaces only and cannot run "${featureKey}".`,
    );
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { team: { select: { organizationId: true } } },
  });
  const organizationId = project?.team?.organizationId;
  if (!organizationId) {
    throw new Error(`Project ${projectId} not found.`);
  }

  const virtualKey = await provisionLangyVirtualKey({
    prisma,
    projectId,
    organizationId,
  });
  if (!virtualKey) {
    throw new Error(
      "No gateway credential could be provisioned for this project yet — open Langy once, or re-connect Codex.",
    );
  }

  const gateway = createOpenAI({
    baseURL: codexGatewayV1BaseUrl(),
    apiKey: virtualKey,
  });
  // The FULL id ("openai_codex/...") — the gateway routes to the codex
  // provider by prefix and strips it before it reaches OpenAI.
  return gateway.responses(model);
}

/**
 * The gateway data plane as reached FROM the control plane, normalised to
 * /v1. `LW_GATEWAY_INTERNAL_URL` is the dedicated control-plane → gateway
 * var; the public URL and the legacy shared var are the documented
 * fallbacks (see env-create.mjs). `LW_GATEWAY_BASE_URL` alone would be
 * wrong-by-default: the Go gateway hijacks that name for the OPPOSITE
 * direction, so in dev it points at the app itself.
 */
function codexGatewayV1BaseUrl(): string {
  const base =
    env.LW_GATEWAY_INTERNAL_URL ??
    env.LW_GATEWAY_PUBLIC_URL ??
    env.LW_GATEWAY_BASE_URL;
  if (!base) {
    throw new Error(
      "The AI gateway URL is not configured on the control plane (LW_GATEWAY_INTERNAL_URL / LW_GATEWAY_PUBLIC_URL); it is required for Codex models.",
    );
  }
  return ensureGatewayV1BaseUrl(base);
}
