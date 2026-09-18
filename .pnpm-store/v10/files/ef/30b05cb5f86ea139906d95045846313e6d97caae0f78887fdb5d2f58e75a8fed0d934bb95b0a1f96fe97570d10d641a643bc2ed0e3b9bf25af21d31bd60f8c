"use strict";
// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", { value: true });
exports.Responses = void 0;
const tslib_1 = require("../../../internal/tslib.js");
const resource_1 = require("../../../core/resource.js");
const InputItemsAPI = tslib_1.__importStar(require("./input-items.js"));
const input_items_1 = require("./input-items.js");
const InputTokensAPI = tslib_1.__importStar(require("./input-tokens.js"));
const input_tokens_1 = require("./input-tokens.js");
const headers_1 = require("../../../internal/headers.js");
const path_1 = require("../../../internal/utils/path.js");
class Responses extends resource_1.APIResource {
    constructor() {
        super(...arguments);
        this.inputItems = new InputItemsAPI.InputItems(this._client);
        this.inputTokens = new InputTokensAPI.InputTokens(this._client);
    }
    create(params, options) {
        const { betas, ...body } = params;
        return this._client.post('/responses?beta=true', {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([
                { ...(betas?.toString() != null ? { 'openai-beta': betas?.toString() } : undefined) },
                options?.headers,
            ]),
            stream: params.stream ?? false,
            __security: { bearerAuth: true },
        });
    }
    retrieve(responseID, params = {}, options) {
        const { betas, ...query } = params ?? {};
        return this._client.get((0, path_1.path) `/responses/${responseID}?beta=true`, {
            query,
            ...options,
            headers: (0, headers_1.buildHeaders)([
                { ...(betas?.toString() != null ? { 'openai-beta': betas?.toString() } : undefined) },
                options?.headers,
            ]),
            stream: params?.stream ?? false,
            __security: { bearerAuth: true },
        });
    }
    /**
     * Deletes a model response with the given ID.
     *
     * @example
     * ```ts
     * await client.beta.responses.delete(
     *   'resp_677efb5139a88190b512bc3fef8e535d',
     * );
     * ```
     */
    delete(responseID, params = {}, options) {
        const { betas } = params ?? {};
        return this._client.delete((0, path_1.path) `/responses/${responseID}?beta=true`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([
                { Accept: '*/*', ...(betas?.toString() != null ? { 'openai-beta': betas?.toString() } : undefined) },
                options?.headers,
            ]),
            __security: { bearerAuth: true },
        });
    }
    /**
     * Cancels a model response with the given ID. Only responses created with the
     * `background` parameter set to `true` can be cancelled.
     * [Learn more](https://platform.openai.com/docs/guides/background).
     *
     * @example
     * ```ts
     * const betaResponse = await client.beta.responses.cancel(
     *   'resp_677efb5139a88190b512bc3fef8e535d',
     * );
     * ```
     */
    cancel(responseID, params = {}, options) {
        const { betas } = params ?? {};
        return this._client.post((0, path_1.path) `/responses/${responseID}/cancel?beta=true`, {
            ...options,
            headers: (0, headers_1.buildHeaders)([
                { ...(betas?.toString() != null ? { 'openai-beta': betas?.toString() } : undefined) },
                options?.headers,
            ]),
            __security: { bearerAuth: true },
        });
    }
    /**
     * Compact a conversation. Returns a compacted response object.
     *
     * Learn when and how to compact long-running conversations in the
     * [conversation state guide](https://platform.openai.com/docs/guides/conversation-state#managing-the-context-window).
     * For ZDR-compatible compaction details, see
     * [Compaction (advanced)](https://platform.openai.com/docs/guides/conversation-state#compaction-advanced).
     *
     * @example
     * ```ts
     * const betaCompactedResponse =
     *   await client.beta.responses.compact({
     *     model: 'gpt-5.6-sol',
     *   });
     * ```
     */
    compact(params, options) {
        const { betas, ...body } = params;
        return this._client.post('/responses/compact?beta=true', {
            body,
            ...options,
            headers: (0, headers_1.buildHeaders)([
                { ...(betas?.toString() != null ? { 'openai-beta': betas?.toString() } : undefined) },
                options?.headers,
            ]),
            __security: { bearerAuth: true },
        });
    }
}
exports.Responses = Responses;
Responses.InputItems = input_items_1.InputItems;
Responses.InputTokens = input_tokens_1.InputTokens;
//# sourceMappingURL=responses.js.map