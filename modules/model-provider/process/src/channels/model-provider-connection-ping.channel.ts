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
