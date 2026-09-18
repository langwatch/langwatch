// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
import { APIResource } from "../../../core/resource.mjs";
import * as InputItemsAPI from "./input-items.mjs";
import { InputItems } from "./input-items.mjs";
import * as InputTokensAPI from "./input-tokens.mjs";
import { InputTokens } from "./input-tokens.mjs";
import { buildHeaders } from "../../../internal/headers.mjs";
import { path } from "../../../internal/utils/path.mjs";
export class Responses extends APIResource {
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
            headers: buildHeaders([
                { ...(betas?.toString() != null ? { 'openai-beta': betas?.toString() } : undefined) },
                options?.headers,
            ]),
            stream: params.stream ?? false,
            __security: { bearerAuth: true },
        });
    }
    retrieve(responseID, params = {}, options) {
        const { betas, ...query } = params ?? {};
        return this._client.get(path `/responses/${responseID}?beta=true`, {
            query,
            ...options,
            headers: buildHeaders([
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
        return this._client.delete(path `/responses/${responseID}?beta=true`, {
            ...options,
            headers: buildHeaders([
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
        return this._client.post(path `/responses/${responseID}/cancel?beta=true`, {
            ...options,
            headers: buildHeaders([
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
            headers: buildHeaders([
                { ...(betas?.toString() != null ? { 'openai-beta': betas?.toString() } : undefined) },
                options?.headers,
            ]),
            __security: { bearerAuth: true },
        });
    }
}
Responses.InputItems = InputItems;
Responses.InputTokens = InputTokens;
//# sourceMappingURL=responses.mjs.map