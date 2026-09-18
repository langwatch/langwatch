// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
import { APIResource } from "../../../core/resource.mjs";
import { buildHeaders } from "../../../internal/headers.mjs";
export class InputTokens extends APIResource {
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
            headers: buildHeaders([
                { ...(betas?.toString() != null ? { 'openai-beta': betas?.toString() } : undefined) },
                options?.headers,
            ]),
            __security: { bearerAuth: true },
        });
    }
}
//# sourceMappingURL=input-tokens.mjs.map