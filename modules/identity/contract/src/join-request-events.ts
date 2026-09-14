/** Join-request pipeline identity: one aggregate per request keyed by joinRequestId, tenanted by
 * organizationId. Separate from identity due to differing key and tenant shape. See ADR-117.
 */
export const JOIN_REQUEST_PIPELINE_NAME = "join-requests" as const;
export const JOIN_REQUEST_AGGREGATE_TYPE = "join_request" as const;
