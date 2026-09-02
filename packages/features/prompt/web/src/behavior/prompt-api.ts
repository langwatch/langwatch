/**
 * The procedures this screen calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as `gateway-api.ts`,
 * `governance-api.ts`, `automation-api.ts`, `ops-api.ts`, `agent-api.ts`,
 * `data-retention-api.ts`, `dataset-api.ts` and `model-provider-api.ts` say of
 * their own maps: the procedures are mounted by the process out of
 * `@langwatch/prompt-server`, `@langwatch/trace-server` and the application's
 * own routers, which a web package may not import even for a type, and the
 * router type does not exist until a process instantiates it. Emitting this
 * file from the mounted router is the fix; writing it by hand is the interim.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `prompts`, `promptTags`, `modelProvider`,
 * `llmModelCost`, `spans`, `traces` and `experiments` are mount points on the
 * root router and tRPC hashes that path into the React Query cache key; spell
 * one differently and these hooks quietly stop sharing a cache with the
 * `promptApi.prompts.*` call sites that have not moved — of which there are many,
 * because the prompt editor drawer, the workflow signature panel and the
 * experiments workbench all still read prompts from `platform/app`.
 *
 * WHERE A PAYLOAD IS `unknown` IT IS DELIBERATE: those entries are declared for
 * their CACHE ENTRY rather than for a call, so an invalidation from this screen
 * reaches a list an un-migrated surface created. The shape the model-provider
 * family introduced for the same reason.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package. Recorded here so the finding it
 * raises is a decision rather than a surprise.
 */

import { createFeatureApi } from "@langwatch/platform-api-client";
import type {
  LegacyModelProvider,
  ModelDefaultEffective,
  ModelProviderListEntry,
} from "@langwatch/model-provider-contract";
import type {
  PromptCopySummary,
  PromptCreateTrpcInput,
  PromptDeleteResult,
  PromptModifyPermission,
  PromptSyncResult,
  PromptTag,
  PromptTagAssignment,
  PromptUpdateTrpcInput,
  VersionedPrompt,
} from "@langwatch/prompt-contract";
import type { PromptStudioSpanResult } from "@langwatch/trace-contract";

/** The project every project-scoped procedure is narrowed to. */
type ProjectScope = { projectId: string };

/** One prompt inside one project, addressed by id or handle. */
type PromptReferenceScope = ProjectScope & { idOrHandle: string };

/** One copy of a prompt, as the push-to-copies picker lists them. */
export type PromptCopyRow = PromptCopySummary & {
  fullPath: string;
  hasPermission: boolean;
};

export type PromptApiMap = {
  prompts: {
    /** Every prompt in the project — the sidebar's catalogue. */
    getAllPromptsForProject: {
      query: { input: ProjectScope; output: VersionedPrompt[] };
    };

    /**
     * One prompt, optionally at a named version or tag.
     *
     * The drift check, the version history and the span hand-off all land on
     * this entry, so the four inputs stay optional rather than being split into
     * separate procedures.
     */
    getByIdOrHandle: {
      query: {
        input: PromptReferenceScope & {
          versionId?: string;
          version?: number;
          tag?: string;
        };
        output: VersionedPrompt | null;
      };
    };

    getAllVersionsForPrompt: {
      query: { input: PromptReferenceScope; output: VersionedPrompt[] };
    };

    /** Whether the reader may rename or delete this prompt, and why not. */
    checkModifyPermission: {
      query: { input: PromptReferenceScope; output: PromptModifyPermission };
    };

    /** The copies of a prompt the reader may push to, already filtered. */
    getCopies: {
      query: { input: PromptReferenceScope; output: PromptCopyRow[] };
    };

    /** Whether a handle is free, before a rename is offered. */
    checkHandleUniqueness: {
      query: {
        input: ProjectScope & { handle: string; scope: "PROJECT" | "ORGANIZATION" };
        output: boolean;
      };
    };

    /** Which tag points at which version of one prompt. */
    getTagsForConfig: {
      query: { input: ProjectScope & { configId: string }; output: PromptTagAssignment[] };
    };

    create: { mutation: { input: PromptCreateTrpcInput; output: VersionedPrompt } };
    update: { mutation: { input: PromptUpdateTrpcInput; output: VersionedPrompt } };
    updateHandle: {
      mutation: {
        input: ProjectScope & {
          id: string;
          data: { handle: string | null; scope: "PROJECT" | "ORGANIZATION" };
        };
        output: VersionedPrompt;
      };
    };
    restoreVersion: {
      mutation: { input: ProjectScope & { versionId: string }; output: VersionedPrompt };
    };
    delete: { mutation: { input: PromptReferenceScope; output: PromptDeleteResult } };
    duplicate: { mutation: { input: PromptReferenceScope; output: VersionedPrompt } };
    copy: {
      mutation: {
        input: PromptReferenceScope & { sourceProjectId: string };
        output: VersionedPrompt & { copiedFromPromptId: string };
      };
    };
    pushToCopies: {
      mutation: {
        input: PromptReferenceScope & { copyIds?: string[] };
        output: { pushed: number; failed: number };
      };
    };
    syncFromSource: {
      mutation: { input: PromptReferenceScope; output: PromptSyncResult };
    };
    assignTag: {
      mutation: {
        input: ProjectScope & { configId: string; versionId: string; tag: string };
        output: PromptTagAssignment;
      };
    };
  };

  promptTags: {
    getAll: { query: { input: ProjectScope; output: PromptTag[] } };
    create: { mutation: { input: ProjectScope & { name: string }; output: PromptTag } };
    delete: { mutation: { input: ProjectScope & { name: string }; output: unknown } };
  };

  modelProvider: {
    /**
     * The project's configured providers, keyed by provider id.
     *
     * `LegacyModelProvider` is the shape `toLegacyProviderMap` answers with and
     * `mergeCustomModelMetadata` takes, both published by
     * `@langwatch/model-provider-contract` — so naming it here is a real
     * declaration rather than a restatement, and the custom-model merge is
     * checked against the same type on both sides of the wire.
     */
    getAllForProjectForFrontend: {
      query: { input: ProjectScope; output: Record<string, LegacyModelProvider> };
    };

    /** Every stored provider row, flat — what the picker's scope filter reads. */
    listAllForProjectForFrontend: {
      query: { input: ProjectScope; output: ModelProviderListEntry[] };
    };

    /**
     * The default model for a feature key, when the prompt names none.
     *
     * Null rather than throwing when nothing is configured at any scope, which
     * is what lets the picker render its "configure a default" hint.
     */
    getResolvedDefault: {
      query: {
        input: ProjectScope & { featureKey: string };
        output: ModelDefaultEffective | null;
      };
    };
  };

  llmModelCost: {
    /** The context window and output ceiling the token gauge is drawn against. */
    getModelLimits: {
      query: {
        input: ProjectScope & { model: string };
        output: { maxInputTokens?: number; maxOutputTokens?: number } | null;
      };
    };
  };

  spans: {
    /** One LLM span, reshaped into what a prompt tab opens with. */
    getForPromptStudio: {
      query: {
        input: ProjectScope & { spanId: string };
        output: PromptStudioSpanResult | null;
      };
    };
  };

  traces: {
    /**
     * Declared so the chat's View Trace affordance can ask whether the trace
     * has landed yet. Nothing here renders the trace — the button writes the
     * trace drawer's address and the application opens it.
     */
    getById: { query: { input: ProjectScope & { traceId: string }; output: unknown } };
  };

  organization: {
    /**
     * The organization graph, narrowed to what this family reads off it.
     *
     * Read by the frontend feature that mounts the screen rather than by the
     * screen, and declared here so it lands on the same cache entry as the
     * application shell's own read of it: the graph is fetched once per
     * document however many halves of the product want it.
     *
     * `apiKey` is the project's, and the server already decides who may see it
     * — it arrives blank for a reader who cannot update the project, and for
     * every demo project. Two surfaces send it rather than display it: the
     * playground chat authenticates its run with it, and the deploy dialog
     * seeds the snippets it prints. The membership columns are declared because
     * the replication picker offers only the projects the reader may create a
     * prompt in, and that answer is per TEAM rather than per current scope.
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
            members?: Array<{
              userId: string;
              role: string;
              assignedRole?: { permissions?: unknown } | null;
            }>;
            projects: Array<{ id: string; name: string; slug: string; apiKey?: string }>;
          }>;
        }>;
      };
    };
  };

  experiments: {
    /** Creates the experiment the playground hands its open tabs off to. */
    saveEvaluationsV3: {
      mutation: { input: Record<string, unknown>; output: { slug: string } };
    };

    /**
     * Declared for its cache entry, like the model-provider reads above: the
     * experiments list is the application's and has to be invalidated when the
     * playground creates one, or the workbench keeps the stale list.
     */
    getAllForEvaluationsList: { query: { input: ProjectScope; output: unknown } };
  };
};

/**
 * The Prompt family's typed tRPC hooks. Same machinery, same transport and the
 * same React Query cache as the application's `api` proxy — see
 * `createFeatureApi` for why separate instances still share cache entries.
 *
 * INTERNAL to this package by convention: the screen calls it, and the process
 * shell mounts `promptApi.Provider`.
 */
export const promptApi = createFeatureApi<PromptApiMap>();
