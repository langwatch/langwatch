import { createOpenAI } from "@ai-sdk/openai";
import { defaultSettingsMiddleware, wrapLanguageModel } from "ai";
import { env } from "../../env.mjs";
import { ensureGatewayV1BaseUrl } from "@langwatch/langy-contract";
import { provisionLangyVirtualKey } from "~/runtime/app/features/langy-virtual-key.adapter";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "../db";
import { ModelRestrictedForExecutionError } from "@langwatch/model-provider-contract";
import { isModelAllowedForFeature } from "@langwatch/model-provider-contract";

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
  gatewayUrl,
}: {
  projectId: string;
  model: string;
  featureKey: string;
  /**
   * The gateway base URL the process resolved into its `ModelClientConfig`.
   * Absent for callers that hold no config, which fall back to the deployment
   * variables below.
   */
  gatewayUrl?: string;
}) {
  if (!isModelAllowedForFeature({ modelId: model, featureKey })) {
    throw new ModelRestrictedForExecutionError({ model, provider: null, featureKey });
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
    virtualKeys: getApp().gatewayStores.virtualKeys,
    projectId,
    organizationId,
  });
  if (!virtualKey) {
    throw new Error(
      "No gateway credential could be provisioned for this project yet — open Langy once, or re-connect Codex.",
    );
  }

  const gateway = createOpenAI({
    baseURL: codexGatewayV1BaseUrl(gatewayUrl),
    apiKey: virtualKey,
  });
  // The FULL id ("openai_codex/...") — the gateway routes to the codex
  // provider by prefix and strips it before it reaches OpenAI.
  //
  // store:false is load-bearing. The codex backend is stateless: it keeps no
  // server-side response state, so across a tool loop's steps every reasoning
  // item has to be replayed in full. The AI SDK only round-trips the encrypted
  // reasoning content, and only asks the backend to return it via
  // include:["reasoning.encrypted_content"], when it KNOWS the store is off.
  // Without this default it replays bare reasoning ids the stateless backend
  // rejects, and every multi-step codex turn dies with a 400. The gateway pins
  // store:false on the wire too; this keeps the client's view of the turn in
  // step with that.
  return wrapLanguageModel({
    model: gateway.responses(model),
    middleware: defaultSettingsMiddleware({
      settings: { providerOptions: { openai: { store: false } } },
    }),
  });
}

/**
 * The gateway data plane as reached FROM the control plane, normalised to
 * /v1. An injected URL wins: the process resolves one into `ModelClientConfig`
 * with exactly the precedence below, so a caller that has it should not make
 * this function read the environment a second time. Otherwise
 * `LW_GATEWAY_INTERNAL_URL` is the dedicated control-plane → gateway var; the
 * public URL and the legacy shared var are the documented fallbacks (see
 * env-create.mjs). `LW_GATEWAY_BASE_URL` alone would be wrong-by-default: the
 * Go gateway hijacks that name for the OPPOSITE direction, so in dev it points
 * at the app itself.
 */
function codexGatewayV1BaseUrl(injected: string | undefined): string {
  const base =
    injected ??
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
