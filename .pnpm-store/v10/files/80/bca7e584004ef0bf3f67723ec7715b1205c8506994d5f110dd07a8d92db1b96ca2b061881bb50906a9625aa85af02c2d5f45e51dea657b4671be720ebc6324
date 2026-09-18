import { APIResource } from "../../../core/resource.js";
import * as ResponsesAPI from "./responses.js";
import { BetaResponseItemsPage } from "./responses.js";
import { type CursorPageParams, PagePromise } from "../../../core/pagination.js";
import { RequestOptions } from "../../../internal/request-options.js";
export declare class InputItems extends APIResource {
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
    list(responseID: string, params?: InputItemListParams | null | undefined, options?: RequestOptions): PagePromise<BetaResponseItemsPage, ResponsesAPI.BetaResponseItem>;
}
/**
 * A list of Response items.
 */
export interface BetaResponseItemList {
    /**
     * A list of items used to generate this response.
     */
    data: Array<ResponsesAPI.BetaResponseItem>;
    /**
     * The ID of the first item in the list.
     */
    first_id: string;
    /**
     * Whether there are more items available.
     */
    has_more: boolean;
    /**
     * The ID of the last item in the list.
     */
    last_id: string;
    /**
     * The type of object returned, must be `list`.
     */
    object: 'list';
}
export interface InputItemListParams extends CursorPageParams {
    /**
     * Query param: Additional fields to include in the response. See the `include`
     * parameter for Response creation above for more information.
     */
    include?: Array<ResponsesAPI.BetaResponseIncludable>;
    /**
     * Query param: The order to return the input items in. Default is `desc`.
     *
     * - `asc`: Return the input items in ascending order.
     * - `desc`: Return the input items in descending order.
     */
    order?: 'asc' | 'desc';
    /**
     * Header param: Optional beta features to enable for this request.
     */
    betas?: Array<'responses_multi_agent=v1'>;
}
export declare namespace InputItems {
    export { type BetaResponseItemList as BetaResponseItemList, type InputItemListParams as InputItemListParams, };
}
export { type BetaResponseItemsPage };
//# sourceMappingURL=input-items.d.ts.map