import * as Errors from "../error.mjs";
import type { ApiKeySetter } from "../client.mjs";
import type { FinalizedRequestInit } from "./types.mjs";
import type { ProviderRequestContext } from "./provider.mjs";
export interface BedrockEndpointOptions {
    /** AWS region used to derive the default Mantle endpoint. */
    region?: string | undefined;
    /** Bedrock API root. Defaults to AWS_BEDROCK_BASE_URL or the regional Mantle endpoint. */
    baseURL?: string | null | undefined;
}
export interface BedrockBearerOptions {
    /** Explicit Bedrock bearer credential. Set to null to skip the environment bearer fallback. */
    apiKey?: string | null | undefined;
    /** A function that resolves a Bedrock bearer credential before every request attempt. */
    tokenProvider?: ApiKeySetter | undefined;
}
export interface BedrockRequestAuth {
    prepareRequest(request: FinalizedRequestInit, context: ProviderRequestContext): void | Promise<void>;
}
export type BedrockAuthFactory = () => BedrockRequestAuth;
export declare function errorWithCause(message: string, cause: unknown): Errors.OpenAIError;
export declare function normalizeOptionalString(value: string | null | undefined): string | undefined;
export declare function resolveBedrockEndpoint(options: BedrockEndpointOptions): {
    region: string | undefined;
    baseURL: string;
};
export declare function assertProviderOwnsAuthorization(headers: Headers): void;
export declare function resolveBedrockBearerAuth(options: BedrockBearerOptions, { allowEnvironment }?: {
    allowEnvironment?: boolean;
}): {
    factory: BedrockAuthFactory | undefined;
    explicit: boolean;
};
//# sourceMappingURL=bedrock.d.mts.map