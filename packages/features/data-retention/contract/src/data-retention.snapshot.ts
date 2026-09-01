/**
 * What the retention settings page reads, as a portable shape.
 *
 * The procedure that answers it — `dataRetention.getRules` — is mounted by the
 * process, and the read model behind it still lives in `platform/app`
 * (`server/data-retention/policy/dataRetentionPolicy.read.ts`) because it
 * resolves organization lineage and an active plan out of stores this feature
 * deliberately does not reach into. `DataRetentionTrpcApi` is generic over the
 * snapshot for exactly that reason.
 *
 * The browser still has to name the shape it renders, and it may import neither
 * `platform/app` nor a server package. So the wire shape is DECLARED here and
 * the read model produces it. That is a restatement rather than a move, and the
 * reason is recorded rather than hidden: the migration ruling forbids editing
 * `platform/app`, so the application's copy cannot be repointed at this one
 * until the read model itself moves into `@langwatch/data-retention-server`.
 * Until then the two must stay aligned — the same promise
 * `@langwatch/enterprise-billing-contract` makes about its Prisma enum copies.
 */

import type { RetentionCategory, RetentionScopeType, ResolvedRetention } from "./data-retention";

/** One scope a retention rule can be bound to, named for a reader. */
export type RetentionScopeRef = {
  scopeType: RetentionScopeType;
  scopeId: string;
  name: string;
};

/** One stored override: a scope, a category, and the days it keeps. */
export type RetentionRule = RetentionScopeRef & {
  category: RetentionCategory;
  retentionDays: number;
};

/**
 * The scopes the caller may write an override at, RBAC-filtered by the server.
 *
 * A caller who can read the page but write nowhere gets every list empty, which
 * is what the page reads to decide whether to offer the add and edit controls
 * at all.
 */
export type RetentionScopeAvailable = {
  organization: { id: string; name: string } | null;
  teams: { id: string; name: string }[];
  projects: { id: string; name: string; teamId: string }[];
};

/** Everything one render of the retention settings page is built from. */
export type RetentionPolicySnapshot = {
  projectId: string;
  /**
   * Effective per-category retention for this project, falling back to the
   * platform default when no override is set anywhere in the cascade.
   */
  effective: ResolvedRetention;
  /** Override rows the caller can read, one per (scope, category). */
  rules: RetentionRule[];
  /** Scopes the caller can write to (RBAC-filtered), for the chip picker. */
  available: RetentionScopeAvailable;
  /**
   * Whether the organization's plan unlocks configurable retention. Free plans
   * see the snapshot but must not be offered the add, edit or delete controls.
   */
  canConfigureRetention: boolean;
};

/**
 * Stored bytes for the scope the selector resolves to, and how many projects
 * contributed — the card says "across N projects" for a wider scope.
 */
export type RetentionStorageUsage = {
  totalBytes: number;
  projectCount: number;
};
