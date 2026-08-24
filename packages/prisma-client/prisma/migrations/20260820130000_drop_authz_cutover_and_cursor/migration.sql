-- ADR-110. Finishing the migration is the switch, so there is no cutover
-- record to keep: the organization's migration status is the read fork.
DROP TABLE IF EXISTS "AuthzCutoverProjection";

-- Keyed by organizationId, which is no longer an aggregate. Aggregates are
-- authz_grant and authz_role; the replacement cursor is created with the
-- projection that uses it. Nothing is in production on these rows.
DROP TABLE IF EXISTS "AuthzProjectionCursor";
