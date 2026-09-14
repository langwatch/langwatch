/** Directory-sync pipeline identity: one aggregate per sync keyed by scimSyncId, tenanted by
 * organizationId. Separate pipeline because sync and connection lifecycles differ. See D08.
 */
export const SCIM_SYNC_PIPELINE_NAME = "scim-sync" as const;
export const SCIM_SYNC_AGGREGATE_TYPE = "scim_sync" as const;
