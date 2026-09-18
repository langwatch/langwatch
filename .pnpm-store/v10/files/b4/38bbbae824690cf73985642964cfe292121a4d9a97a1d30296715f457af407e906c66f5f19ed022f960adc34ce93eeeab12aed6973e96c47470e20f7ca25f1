"use strict";
// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
Object.defineProperty(exports, "__esModule", { value: true });
exports.InputItems = void 0;
const resource_1 = require("../../../core/resource.js");
const pagination_1 = require("../../../core/pagination.js");
const headers_1 = require("../../../internal/headers.js");
const path_1 = require("../../../internal/utils/path.js");
class InputItems extends resource_1.APIResource {
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
        return this._client.getAPIList((0, path_1.path) `/responses/${responseID}/input_items?beta=true`, (pagination_1.CursorPage), {
            query,
            ...options,
            headers: (0, headers_1.buildHeaders)([
                { ...(betas?.toString() != null ? { 'openai-beta': betas?.toString() } : undefined) },
                options?.headers,
            ]),
            __security: { bearerAuth: true },
        });
    }
}
exports.InputItems = InputItems;
//# sourceMappingURL=input-items.js.map