"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorWithCause = errorWithCause;
exports.normalizeOptionalString = normalizeOptionalString;
exports.resolveBedrockEndpoint = resolveBedrockEndpoint;
exports.assertProviderOwnsAuthorization = assertProviderOwnsAuthorization;
exports.resolveBedrockBearerAuth = resolveBedrockBearerAuth;
const tslib_1 = require("./tslib.js");
const Errors = tslib_1.__importStar(require("../error.js"));
const utils_1 = require("./utils.js");
function errorWithCause(message, cause) {
    const error = new Errors.OpenAIError(message);
    error.cause = cause;
    return error;
}
function normalizeOptionalString(value) {
    const normalized = typeof value === 'string' ? value.trim() : undefined;
    return normalized ? normalized : undefined;
}
function normalizeBaseURL(baseURL) {
    const url = new URL(baseURL);
    const responsesMatch = url.pathname.match(/\/responses(?:\/.*)?$/);
    if (responsesMatch?.index !== undefined) {
        url.pathname = url.pathname.slice(0, responsesMatch.index) || '/';
    }
    return url.toString().replace(/\/$/, '');
}
function resolveBedrockEndpoint(options) {
    if (options.region !== undefined && !normalizeOptionalString(options.region)) {
        throw new Errors.OpenAIError('The Bedrock AWS `region` must not be empty.');
    }
    if (options.baseURL !== undefined &&
        options.baseURL !== null &&
        !normalizeOptionalString(options.baseURL)) {
        throw new Errors.OpenAIError('The Bedrock `baseURL` must not be empty.');
    }
    const region = normalizeOptionalString(options.region) ??
        normalizeOptionalString((0, utils_1.readEnv)('AWS_REGION')) ??
        normalizeOptionalString((0, utils_1.readEnv)('AWS_DEFAULT_REGION'));
    const configuredBaseURL = options.baseURL === undefined ? normalizeOptionalString((0, utils_1.readEnv)('AWS_BEDROCK_BASE_URL'))
        : options.baseURL === null ? undefined
            : normalizeOptionalString(options.baseURL);
    if (configuredBaseURL)
        return { region, baseURL: normalizeBaseURL(configuredBaseURL) };
    if (!region) {
        throw new Errors.OpenAIError('Bedrock requires an AWS region. Pass `region` to `bedrock(...)`, or set `AWS_REGION` or `AWS_DEFAULT_REGION`.');
    }
    return { region, baseURL: `https://bedrock-mantle.${region}.api.aws/openai/v1` };
}
function assertProviderOwnsAuthorization(headers) {
    if (headers.has('authorization')) {
        throw new Errors.OpenAIError('Bedrock provider authentication cannot be combined with a custom `Authorization` header.');
    }
}
class BedrockBearerAuth {
    constructor(tokenProvider) {
        this.tokenProvider = tokenProvider;
    }
    async prepareRequest(request, _context) {
        const headers = new Headers(request.headers);
        assertProviderOwnsAuthorization(headers);
        let token;
        try {
            token = await this.tokenProvider();
        }
        catch (cause) {
            throw errorWithCause('Failed to resolve a bearer credential for Bedrock.', cause);
        }
        if (typeof token !== 'string' || !token.trim()) {
            throw new Errors.OpenAIError('The Bedrock bearer credential provider must return a non-empty string.');
        }
        headers.set('authorization', `Bearer ${token}`);
        request.headers = headers;
    }
}
function resolveBedrockBearerAuth(options, { allowEnvironment = true } = {}) {
    if (options.apiKey !== undefined &&
        options.apiKey !== null &&
        (typeof options.apiKey !== 'string' || !options.apiKey.trim())) {
        throw new Errors.OpenAIError('The Bedrock bearer credential must not be empty.');
    }
    if (options.apiKey != null && options.tokenProvider) {
        throw new Errors.OpenAIError('The `apiKey` and `tokenProvider` options are mutually exclusive. Configure only one.');
    }
    if (options.tokenProvider) {
        const tokenProvider = options.tokenProvider;
        return { factory: () => new BedrockBearerAuth(tokenProvider), explicit: true };
    }
    if (options.apiKey != null) {
        const apiKey = options.apiKey;
        return { factory: () => new BedrockBearerAuth(async () => apiKey), explicit: true };
    }
    if (allowEnvironment && options.apiKey !== null && (0, utils_1.readEnv)('AWS_BEARER_TOKEN_BEDROCK')) {
        return {
            explicit: false,
            factory: () => new BedrockBearerAuth(async () => {
                const token = (0, utils_1.readEnv)('AWS_BEARER_TOKEN_BEDROCK');
                if (!token) {
                    throw new Errors.OpenAIError('Could not find credentials for Bedrock. Set `AWS_BEARER_TOKEN_BEDROCK` or configure AWS credential authentication.');
                }
                return token;
            }),
        };
    }
    return { factory: undefined, explicit: false };
}
//# sourceMappingURL=bedrock.js.map