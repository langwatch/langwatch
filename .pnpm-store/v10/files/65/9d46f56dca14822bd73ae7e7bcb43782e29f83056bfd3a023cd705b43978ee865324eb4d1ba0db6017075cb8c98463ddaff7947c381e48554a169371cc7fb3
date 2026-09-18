"use strict";
// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", { value: true });
exports.InputTokens = void 0;
const resource_1 = require("../../../core/resource.js");
const headers_1 = require("../../../internal/headers.js");
class InputTokens extends resource_1.APIResource {
    /**
     * Returns input token counts of the request.
     *
     * Returns an object with `object` set to `response.input_tokens` and an
     * `input_tokens` count.
     *
     * @example
     * ```ts
     * const response =
     *   await client.beta.responses.inputTokens.count();
     * ```
     */
    count(params = {}, options) {
        const { betas, ...body } = params ?? {};
        return this._client.post('/responses/input_tokens?beta=true', {
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
exports.InputTokens = InputTokens;
//# sourceMappingURL=input-tokens.js.map