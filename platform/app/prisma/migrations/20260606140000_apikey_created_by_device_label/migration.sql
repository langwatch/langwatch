-- Device-session provenance for ingestion keys. Snapshots the human label of
-- the CLI device session that minted the key (e.g. "Rogerio's MacBook Pro")
-- from the device flow's client_info, so the org-wide API-keys settings page
-- can show which device a key came from without resolving another user's
-- Redis-stored sessions. NULL for non-ingestion keys and for keys minted by a
-- CLI old enough to predate device metadata. No index: only read alongside the
-- row, never filtered on.

ALTER TABLE "ApiKey" ADD COLUMN "createdByDeviceLabel" TEXT;
