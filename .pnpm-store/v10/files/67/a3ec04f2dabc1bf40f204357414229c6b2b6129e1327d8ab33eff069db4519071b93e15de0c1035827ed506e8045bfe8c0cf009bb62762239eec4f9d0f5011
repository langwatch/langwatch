import * as Errors from "../error.mjs";
import { createProvider } from "../internal/provider.mjs";
import { resolveBedrockBearerAuth, resolveBedrockEndpoint, } from "../internal/bedrock.mjs";
/** Configure the standard OpenAI client for Amazon Bedrock using bearer authentication. */
export function bedrock(options = {}) {
    const { baseURL } = resolveBedrockEndpoint(options);
    const { factory } = resolveBedrockBearerAuth(options);
    if (!factory) {
        throw new Errors.OpenAIError('Bedrock bearer authentication requires an `apiKey`, `tokenProvider`, or `AWS_BEARER_TOKEN_BEDROCK`. For AWS credential authentication, import `bedrock` from `openai/providers/bedrock/aws`.');
    }
    return createProvider({
        configure() {
            const auth = factory();
            return {
                name: 'bedrock',
                baseURL,
                prepareRequest: auth.prepareRequest.bind(auth),
            };
        },
    });
}
//# sourceMappingURL=bedrock.mjs.map