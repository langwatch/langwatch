"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIProvider = void 0;
const agents_core_1 = require("@openai/agents-core");
const openai_1 = __importDefault(require("openai"));
const defaults_1 = require("./defaults.js");
const openaiResponsesModel_1 = require("./openaiResponsesModel.js");
const openaiChatCompletionsModel_1 = require("./openaiChatCompletionsModel.js");
/**
 * The provider of OpenAI's models (or Chat Completions compatible ones)
 */
class OpenAIProvider {
    #client;
    #useResponses;
    #options;
    constructor(options = {}) {
        this.#options = options;
        if (this.#options.openAIClient) {
            if (this.#options.apiKey) {
                throw new Error('Cannot provide both apiKey and openAIClient');
            }
            if (this.#options.baseURL) {
                throw new Error('Cannot provide both baseURL and openAIClient');
            }
            this.#client = this.#options.openAIClient;
        }
        this.#useResponses = this.#options.useResponses;
    }
    /**
     * Lazy loads the OpenAI client to not throw an error if you don't have an API key set but
     * never actually use the client.
     */
    #getClient() {
        // If the constructor does not accept the OpenAI client,
        if (!this.#client) {
            this.#client =
                // this provider checks if there is the default client first,
                (0, defaults_1.getDefaultOpenAIClient)() ??
                    // and then manually creates a new one.
                    new openai_1.default({
                        apiKey: this.#options.apiKey ?? (0, defaults_1.getDefaultOpenAIKey)(),
                        baseURL: this.#options.baseURL,
                        organization: this.#options.organization,
                        project: this.#options.project,
                    });
        }
        return this.#client;
    }
    async getModel(modelName) {
        const model = modelName || (0, agents_core_1.getDefaultModel)();
        const useResponses = this.#useResponses ?? (0, defaults_1.shouldUseResponsesByDefault)();
        if (useResponses) {
            return new openaiResponsesModel_1.OpenAIResponsesModel(this.#getClient(), model);
        }
        return new openaiChatCompletionsModel_1.OpenAIChatCompletionsModel(this.#getClient(), model);
    }
}
exports.OpenAIProvider = OpenAIProvider;
//# sourceMappingURL=openaiProvider.js.map