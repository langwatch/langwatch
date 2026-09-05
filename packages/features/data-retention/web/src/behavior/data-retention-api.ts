/**
 * The procedures this package calls, and the hooks that call them.
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 */

import type {
  ResolvedRetention,
  RetentionCategory,
  RetentionPolicySnapshot,
  RetentionStorageUsage,
  RetroactiveMutationProgress,
} from "@langwatch/data-retention-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

/** One scope an override is written at. */
type RetentionScopeInput = {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
};

/** The project every retention procedure is scoped to. */
type ProjectScope = { projectId: string };

export type DataRetentionApiMap = {
  dataRetention: {
    /** Effective retention, the readable overrides, and the writable scopes. */
    getRules: {
      query: { input: ProjectScope; output: RetentionPolicySnapshot };
    };

    /** Stored bytes for whatever scope the filter resolves to. */
    getScopeStorageUsage: {
      query: {
        input: ProjectScope & { scope: RetentionScopeInput };
        output: RetentionStorageUsage;
      };
    };

    /**
     * What each category would fall back to if this scope's override were
     * removed. Read rather than guessed, so the confirm dialog names the number
     * the data will actually land on.
     */
    previewScopeRemoval: {
      query: {
        input: ProjectScope & { scope: RetentionScopeInput };
        output: ResolvedRetention;
      };
    };

    /** The retroactive rewrites ClickHouse is running for this project. */
    getMutationProgress: {
      query: { input: ProjectScope; output: RetroactiveMutationProgress[] };
    };

    setForScope: {
      mutation: {
        input: ProjectScope & {
          scope: RetentionScopeInput;
          category: RetentionCategory;
          retentionDays: number;
        };
        output: unknown;
      };
    };

    removeForScope: {
      mutation: {
        input: ProjectScope & {
          scope: RetentionScopeInput;
          category: RetentionCategory;
        };
        output: undefined;
      };
    };

    /**
     * Rewrites the project's EXISTING rows to the effective retention. `appliedRetentionDays`
     * is the value the server resolved through the cascade, which is not always the value the
     * reader just saved: an organization-wide save loses to a closer project override.
     */
    triggerRetroactiveUpdate: {
      mutation: {
        input: ProjectScope & { category: RetentionCategory };
        output: { appliedRetentionDays: number };
      };
    };

    killMutation: {
      mutation: { input: ProjectScope & { mutationId: string }; output: undefined };
    };
  };

  organization: {
    /**
     * The organization graph, narrowed to what the scope FILTER needs.
     */
    getAll: {
      query: {
        input: { isDemo?: boolean };
        output: Array<{
          id: string;
          name: string;
          teams: Array<{
            id: string;
            name: string;
            projects: Array<{ id: string; name: string }>;
          }>;
        }>;
      };
    };
  };
};

/**
 * The Data Retention family's typed tRPC hooks. Same machinery, same transport and same React
 * Query cache as the application's `api` proxy — see `createFeatureApi` for why separate
 * instances still share cache entries.
 */
export const dataRetentionApi = createFeatureApi<DataRetentionApiMap>();
