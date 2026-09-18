import { OpenAI } from "./client.mjs";
import type { ApiKeySetter, ClientOptions } from "./client.mjs";
import type { NullableHeaders } from "./internal/headers.mjs";
import type { FinalRequestOptions } from "./internal/request-options.mjs";
export interface BedrockClientOptions extends Omit<ClientOptions, 'apiKey' | 'adminAPIKey' | 'baseURL' | 'workloadIdentity'> {
    /**
     * Bedrock bearer token used for authentication.
     *
     * Defaults to process.env['AWS_BEARER_TOKEN_BEDROCK'].
     */
    apiKey?: string | null | undefined;
    /**
     * Bedrock API root.
     *
     * Defaults to process.env['AWS_BEDROCK_BASE_URL'], or derives
     * `https://bedrock-mantle.<region>.api.aws/openai/v1` from `awsRegion`,
     * process.env['AWS_REGION'], or process.env['AWS_DEFAULT_REGION'].
     */
    baseURL?: string | null | undefined;
    /**
     * BedrockOpenAI only supports Bedrock bearer token authentication.
     */
    adminAPIKey?: never;
    /**
     * BedrockOpenAI only supports Bedrock bearer token authentication.
     */
    workloadIdentity?: never;
    /**
     * AWS region used to derive the default Bedrock Mantle endpoint.
     *
     * Defaults to process.env['AWS_REGION'] or process.env['AWS_DEFAULT_REGION'].
     */
    awsRegion?: string | undefined;
    /**
     * A function that returns a Bedrock bearer token and is invoked before each request.
     */
    bedrockTokenProvider?: ApiKeySetter | undefined;
}
/** API Client for interfacing with Amazon Bedrock's OpenAI-compatible endpoint. */
export declare class BedrockOpenAI extends OpenAI {
    private readonly bedrockTokenProvider;
    /**
     * API Client for interfacing with Amazon Bedrock's OpenAI-compatible endpoint.
     *
     * @param {string | null | undefined} [opts.apiKey=process.env['AWS_BEARER_TOKEN_BEDROCK'] ?? null]
     * @param {string | null | undefined} [opts.baseURL=process.env['AWS_BEDROCK_BASE_URL'] ?? derived from opts.awsRegion or AWS_REGION/AWS_DEFAULT_REGION]
     * @param {string | undefined} [opts.awsRegion=process.env['AWS_REGION'] ?? process.env['AWS_DEFAULT_REGION'] ?? undefined]
     * @param {ApiKeySetter | undefined} opts.bedrockTokenProvider - A function that returns a Bedrock bearer token and is invoked before each request.
     */
    constructor({ baseURL, apiKey, awsRegion, bedrockTokenProvider, adminAPIKey, workloadIdentity, ...opts }?: BedrockClientOptions);
    protected prepareOptions(options: FinalRequestOptions): Promise<void>;
    protected authHeaders(opts: FinalRequestOptions, schemes?: {
        bearerAuth?: boolean;
        adminAPIKeyAuth?: boolean;
    }): Promise<NullableHeaders | undefined>;
    withOptions(options: Partial<BedrockClientOptions>): this;
}
//# sourceMappingURL=bedrock.d.mts.map