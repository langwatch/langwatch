/**
 * ADR-110 — one migration for the whole move onto the engine. It streams an
 * organization's existing grants in as events, proves the projection agrees,
 * and the moment it finishes that organization is on the engine. There is no
 * second stage and no switch afterwards, which is why there is one name here
 * rather than the genesis/cutover pair this replaces.
 *
 * Its own module because both the gate and the migration runner name it, and
 * the gate must not pull the runner's graph.
 */
export const AUTHZ_ENGINE_MIGRATION_NAME = "authz-engine" as const;
