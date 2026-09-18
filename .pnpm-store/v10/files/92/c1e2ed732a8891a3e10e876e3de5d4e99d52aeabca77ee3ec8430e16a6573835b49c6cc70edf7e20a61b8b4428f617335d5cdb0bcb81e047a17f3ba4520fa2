"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bedrock = bedrock;
const tslib_1 = require("../internal/tslib.js");
const Errors = tslib_1.__importStar(require("../error.js"));
const provider_1 = require("../internal/provider.js");
const bedrock_1 = require("../internal/bedrock.js");
/** Configure the standard OpenAI client for Amazon Bedrock using bearer authentication. */
function bedrock(options = {}) {
    const { baseURL } = (0, bedrock_1.resolveBedrockEndpoint)(options);
    const { factory } = (0, bedrock_1.resolveBedrockBearerAuth)(options);
    if (!factory) {
        throw new Errors.OpenAIError('Bedrock bearer authentication requires an `apiKey`, `tokenProvider`, or `AWS_BEARER_TOKEN_BEDROCK`. For AWS credential authentication, import `bedrock` from `openai/providers/bedrock/aws`.');
    }
    return (0, provider_1.createProvider)({
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
//# sourceMappingURL=bedrock.js.map