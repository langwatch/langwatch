import { createOpenAI } from "@ai-sdk/openai";
import { defaultSettingsMiddleware, generateText, wrapLanguageModel } from "ai";

import { ensureGatewayV1BaseUrl, readPingFailure } from "../../rules/provider-ping.rules.ts";
import {
  ModelProviderCodexGatewayPing,
  type ModelProviderCodexGatewayPingRequest,
} from "../model-provider-codex-gateway-ping.channel.ts";
import type { ModelProviderPingReply } from "../model-provider-connection-ping.channel.ts";

const PING_BUDGET_MS = 20_000;
const PING_PROMPT = "ping";
const UNCONFIGURED_GATEWAY =
  "The AI gateway URL is not configured on the control plane (LW_GATEWAY_INTERNAL_URL / LW_GATEWAY_PUBLIC_URL); it is required for Codex models.";

/**
 * One token down the gateway's Responses endpoint on the project's virtual key. `store: false`
 * matches the stateless Codex backend, as main's handle did (codexGatewayModel.ts).
 */
export class HttpModelProviderCodexGatewayPingChannel extends ModelProviderCodexGatewayPing {
  private constructor(private readonly gatewayBaseUrl: string | undefined) {
    super();
  }

  static create({
    gatewayBaseUrl,
  }: {
    /** The gateway as the control plane reaches it; unset when unconfigured. */
    gatewayBaseUrl: string | undefined;
  }): HttpModelProviderCodexGatewayPingChannel {
    return new HttpModelProviderCodexGatewayPingChannel(gatewayBaseUrl);
  }

  async ping({
    model,
    virtualKey,
  }: ModelProviderCodexGatewayPingRequest): Promise<ModelProviderPingReply> {
    try {
      if (!this.gatewayBaseUrl) throw new Error(UNCONFIGURED_GATEWAY);
      const gateway = createOpenAI({
        baseURL: ensureGatewayV1BaseUrl(this.gatewayBaseUrl),
        apiKey: virtualKey,
      });
      await generateText({
        model: wrapLanguageModel({
          model: gateway.responses(model),
          middleware: defaultSettingsMiddleware({
            settings: { providerOptions: { openai: { store: false } } },
          }),
        }),
        prompt: PING_PROMPT,
        maxOutputTokens: 1,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(PING_BUDGET_MS),
      });
      return { outcome: "generated" };
    } catch (error) {
      return { outcome: "failed", ...readPingFailure(error) };
    }
  }
}
