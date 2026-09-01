/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as `gateway-api.ts`,
 * `governance-api.ts`, `automation-api.ts`, `ops-api.ts` and `agent-api.ts` say
 * of their own maps: the procedures are mounted by the process out of
 * `@langwatch/data-retention-server`, which a web package may not import even
 * for a type, and the router type does not exist until a process instantiates
 * it. Emitting this file from the mounted router is the fix; writing it by hand
 * is the interim, and it is honest because every payload below is
 * `@langwatch/data-retention-contract`'s own.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `dataRetention` and `organization` are
 * mount points on the root router and tRPC hashes that path into the React
 * Query cache key; spell one differently and these hooks quietly stop sharing a cache
 * with the `api.dataRetention.*` call sites that have not moved.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package. Recorded here so the finding it
 * raises is a decision rather than a surprise.
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
        output: void;
      };
    };

    /**
     * Rewrites the project's EXISTING rows to the effective retention.
     *
     * `appliedRetentionDays` is the value the server resolved through the
     * cascade, which is not always the value the reader just saved: an
     * organization-wide save loses to a closer project override. The toast names
     * what the server returns for exactly that reason.
     */
    triggerRetroactiveUpdate: {
      mutation: {
        input: ProjectScope & { category: RetentionCategory };
        output: { appliedRetentionDays: number };
      };
    };

    killMutation: {
      mutation: { input: ProjectScope & { mutationId: string }; output: void };
    };
  };

  organization: {
    /**
     * The organization graph, narrowed to what the scope FILTER needs.
     *
     * Read by the frontend feature that mounts this screen rather than by the
     * screen, and declared here so it lands on the same cache entry as the
     * application shell's own read of it: the graph is fetched once per document
     * however many halves of the product want it. It is deliberately WIDER than
     * the snapshot's `available`, which is the RBAC-filtered set the reader may
     * write to — narrowing the filter to writable scopes would hide rows a
     * project-only reader is allowed to read.
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
 * The Data Retention family's typed tRPC hooks. Same machinery, same transport
 * and same React Query cache as the application's `api` proxy — see
 * `createFeatureApi` for why separate instances still share cache entries.
 *
 * INTERNAL to this package by convention: the screen calls it, and the process
 * shell mounts `dataRetentionApi.Provider`.
 */
export const dataRetentionApi = createFeatureApi<DataRetentionApiMap>();
