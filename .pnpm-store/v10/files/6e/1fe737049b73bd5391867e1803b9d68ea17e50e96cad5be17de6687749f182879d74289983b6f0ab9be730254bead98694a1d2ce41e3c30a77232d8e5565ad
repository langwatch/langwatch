// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
import { APIResource } from "../../../core/resource.mjs";
import { CursorPage } from "../../../core/pagination.mjs";
import { buildHeaders } from "../../../internal/headers.mjs";
import { path } from "../../../internal/utils/path.mjs";
export class InputItems extends APIResource {
    /**
     * Returns a list of input items for a given response.
     *
     * @example
     * ```ts
     * // Automatically fetches more pages as needed.
     * for await (const betaResponseItem of client.beta.responses.inputItems.list(
     *   'response_id',
     * )) {
     *   // ...
     * }
     * ```
     */
    list(responseID, params = {}, options) {
        const { betas, ...query } = params ?? {};
        return this._client.getAPIList(path `/responses/${responseID}/input_items?beta=true`, (CursorPage), {
            query,
            ...options,
            headers: buildHeaders([
                { ...(betas?.toString() != null ? { 'openai-beta': betas?.toString() } : undefined) },
                options?.headers,
            ]),
            __security: { bearerAuth: true },
        });
    }
}
//# sourceMappingURL=input-items.mjs.map