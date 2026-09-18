import * as Errors from "./error.mjs";
import { OpenAI } from "./client.mjs";
import { buildHeaders } from "./internal/headers.mjs";
import { readEnv } from "./internal/utils.mjs";
import { addOutputText } from "./lib/ResponsesParser.mjs";
import * as API from "./resources/index.mjs";
/** Resolve the default Bedrock Mantle API root from the configured AWS region. */
function deriveBedrockBaseURL(awsRegion) {
    const region = awsRegion?.trim();
    if (!region) {
        throw new Errors.OpenAIError('Must provide one of the `baseURL` or `awsRegion` arguments, or set the `AWS_BEDROCK_BASE_URL`, `AWS_REGION`, or `AWS_DEFAULT_REGION` environment variable.');
    }
    return `https://bedrock-mantle.${region}.api.aws/openai/v1`;
}
/** Normalize a Bedrock Responses URL variant back to the provider API root. */
function normalizeBedrockBaseURL(baseURL) {
    const url = new URL(baseURL);
    const responsesMatch = url.pathname.match(/\/responses(?:\/.*)?$/);
    if (responsesMatch?.index !== undefined) {
        url.pathname = url.pathname.slice(0, responsesMatch.index) || '/';
    }
    return url.toString().replace(/\/$/, '');
}
/** Restore the SDK convenience property when Bedrock omits it from a streamed final response. */
function addBedrockOutputText(response) {
    if (!Object.getOwnPropertyDescriptor(response, 'output_text')) {
        addOutputText(response);
    }
    return response;
}
/** Keep the standard Responses surface while repairing Bedrock streamed final responses. */
function restoreBedrockStreamOutputText(responses) {
    const stream = responses.stream.bind(responses);
    responses.stream = ((body, options) => {
        const responseStream = stream(body, options);
        const finalResponse = responseStream.finalResponse.bind(responseStream);
        responseStream.finalResponse = async () => addBedrockOutputText(await finalResponse());
        return responseStream;
    });
    return responses;
}
/** API Client for interfacing with Amazon Bedrock's OpenAI-compatible endpoint. */
export class BedrockOpenAI extends OpenAI {
    /**
     * API Client for interfacing with Amazon Bedrock's OpenAI-compatible endpoint.
     *
     * @param {string | null | undefined} [opts.apiKey=process.env['AWS_BEARER_TOKEN_BEDROCK'] ?? null]
     * @param {string | null | undefined} [opts.baseURL=process.env['AWS_BEDROCK_BASE_URL'] ?? derived from opts.awsRegion or AWS_REGION/AWS_DEFAULT_REGION]
     * @param {string | undefined} [opts.awsRegion=process.env['AWS_REGION'] ?? process.env['AWS_DEFAULT_REGION'] ?? undefined]
     * @param {ApiKeySetter | undefined} opts.bedrockTokenProvider - A function that returns a Bedrock bearer token and is invoked before each request.
     */
    constructor({ baseURL = readEnv('AWS_BEDROCK_BASE_URL'), apiKey, awsRegion = readEnv('AWS_REGION') ?? readEnv('AWS_DEFAULT_REGION'), bedrockTokenProvider, adminAPIKey, workloadIdentity, ...opts } = {}) {
        if (adminAPIKey || workloadIdentity) {
            throw new Errors.OpenAIError('BedrockOpenAI only supports Bedrock bearer token authentication.');
        }
        if (apiKey === undefined && !bedrockTokenProvider) {
            apiKey = readEnv('AWS_BEARER_TOKEN_BEDROCK') ?? null;
        }
        if (typeof apiKey === 'function') {
            throw new Errors.OpenAIError('Pass refreshable Bedrock credentials via `bedrockTokenProvider`, not `apiKey`.');
        }
        if (apiKey && bedrockTokenProvider) {
            throw new Errors.OpenAIError('The `apiKey` and `bedrockTokenProvider` arguments are mutually exclusive; only one can be passed at a time.');
        }
        if (!apiKey && !bedrockTokenProvider) {
            throw new Errors.OpenAIError('Missing credentials. Please pass an `apiKey` or `bedrockTokenProvider`, or set the `AWS_BEARER_TOKEN_BEDROCK` environment variable.');
        }
        const configuredBaseURL = baseURL?.trim() ? baseURL : deriveBedrockBaseURL(awsRegion);
        super({
            apiKey: bedrockTokenProvider ?? apiKey,
            adminAPIKey: null,
            baseURL: normalizeBedrockBaseURL(configuredBaseURL),
            ...opts,
        });
        this.bedrockTokenProvider = bedrockTokenProvider;
        this.responses = restoreBedrockStreamOutputText(new API.Responses(this));
    }
    async prepareOptions(options) {
        const security = options.__security ?? { bearerAuth: true };
        if (security.adminAPIKeyAuth && !security.bearerAuth) {
            await this._callApiKey();
        }
        await super.prepareOptions(options);
    }
    async authHeaders(opts, schemes) {
        const security = schemes ?? { bearerAuth: true, adminAPIKeyAuth: true };
        if ((security.bearerAuth || security.adminAPIKeyAuth) && this.apiKey !== null) {
            return buildHeaders([{ Authorization: `Bearer ${this.apiKey}` }]);
        }
        return super.authHeaders(opts, security);
    }
    withOptions(options) {
        const bedrockTokenProvider = options.apiKey !== undefined ? undefined : options.bedrockTokenProvider ?? this.bedrockTokenProvider;
        return super.withOptions({
            ...options,
            ...(bedrockTokenProvider ? { apiKey: undefined, bedrockTokenProvider } : {}),
        });
    }
}
//# sourceMappingURL=bedrock.mjs.map