import type { ModelProviderExecutionParameters } from "@langwatch/model-provider-contract";

export type ModelProviderPingRequest = Readonly<{
  providerKey: string;
  model: string;
  parameters: ModelProviderExecutionParameters;
}>;

/** What a provider said to one token of generation, in its own words when it refused. */
export type ModelProviderPingReply =
  | Readonly<{ outcome: "generated" }>
  | Readonly<{
      outcome: "failed";
      status: number | undefined;
      message: string;
      responseBody: string;
      thrownAs: string;
    }>;

/** One real generation against a vendor this module does not own: Test Connection's evidence. */
export abstract class ModelProviderConnectionPing {
  abstract ping(request: ModelProviderPingRequest): Promise<ModelProviderPingReply>;
}

/** The address a resolved model executes against when no NLP engine is configured. */
const UNCONFIGURED_EXECUTION_PROXY = "http://nlp-engine-not-configured.invalid";

/** Where nlpgo answers the execution proxy, once an engine address is named. */
const EXECUTION_PROXY_PATH = "/go/proxy/v1";

/** The execution proxy a deployment's engine address implies, fully formed. */
export function executionProxyBaseUrlOf({
  nlpServiceUrl,
}: {
  nlpServiceUrl: string | undefined;
}): string {
  return nlpServiceUrl
    ? `${nlpServiceUrl.replace(/\/$/, "")}${EXECUTION_PROXY_PATH}`
    : UNCONFIGURED_EXECUTION_PROXY;
}
