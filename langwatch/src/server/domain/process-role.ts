/**
 * Which role a Node process is running as.
 *
 * In the domain layer because the event-sourcing runtime gates subscribers and
 * workers on it and must not import `app-layer` (ADR-063). The helper that
 * interprets it (`roleRunsWorkers`) stays with the app config — this is the
 * vocabulary, not the policy.
 */
export type ProcessRole = "web" | "worker" | "migration" | "all";
