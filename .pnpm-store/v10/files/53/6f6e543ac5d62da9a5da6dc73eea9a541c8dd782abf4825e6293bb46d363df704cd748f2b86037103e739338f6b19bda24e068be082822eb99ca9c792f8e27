import type * as ElevenLabs from "../../../../../../index";
/**
 * @example
 *     {
 *         pageSize: 1,
 *         search: "search",
 *         archived: true,
 *         showOnlyOwnedAgents: true,
 *         createdByUserId: "created_by_user_id",
 *         sortDirection: "asc",
 *         sortBy: "name",
 *         cursor: "cursor"
 *     }
 */
export interface AgentsListRequest {
    /** How many Agents to return at maximum. Can not exceed 100, defaults to 30. */
    pageSize?: number;
    /** Search by agents name. */
    search?: string;
    /** Filter agents by archived status */
    archived?: boolean;
    /** If set to true, the endpoint will omit any agents that were shared with you by someone else and include only the ones you own. Deprecated: use created_by_user_id instead. */
    showOnlyOwnedAgents?: boolean;
    /** Filter agents by creator user ID. When set, only agents created by this user are returned. Takes precedence over show_only_owned_agents. Use '@me' to refer to the authenticated user. */
    createdByUserId?: string;
    /** The direction to sort the results */
    sortDirection?: ElevenLabs.SortDirection;
    /** The field to sort the results by */
    sortBy?: ElevenLabs.AgentSortBy;
    /** Used for fetching next page. Cursor is returned in the response. */
    cursor?: string;
}
