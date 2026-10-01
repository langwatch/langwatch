/**
 * The procedures this screen calls, hand-written until the mounted router can
 * generate it (ADR-130). Segment names are load-bearing tRPC cache keys -
 * renaming one breaks sharing with un-migrated `promptApi.prompts.*` call sites.
 */

import { createModuleApi, type OutputsFromMap } from "@langwatch/api/web";
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
     * One prompt, optionally at a named version or tag. The drift check, the
     * version history and the span hand-off all land here, so the four inputs
     * stay optional rather than split into separate procedures.
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
     * `LegacyModelProvider` is `@langwatch/model-provider-contract`'s own shape,
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
     * The default model for a feature key, when the prompt names none. Null
     * rather than throwing when nothing is configured, so the picker can render
     * a "configure a default" hint.
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
     * The organization graph, narrowed to this family's reads. `apiKey` arrives
     * blank when the reader may not see it (server-decided). Membership is per
     * team, since the replication picker only offers creatable projects.
     */
    getAll: {
      query: {
        input: { isDemo?: boolean };
        output: {
          id: string;
          name: string;
          teams: {
            id: string;
            name: string;
            members?: {
              userId: string;
              role: string;
              assignedRole?: { permissions?: unknown } | null;
            }[];
            projects: { id: string; name: string; slug: string; apiKey?: string }[];
          }[];
        }[];
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
 * The Prompt family's typed tRPC hooks - same machinery, transport and React
 * Query cache as the application's `api` proxy (see `createModuleApi`).
 * INTERNAL by convention: the screen calls it, the process shell mounts `promptApi.Provider`.
 */
export const promptApi = createModuleApi<PromptApiMap>();

/** Every procedure's output, as the browser receives it. */
export type RouterOutputs = OutputsFromMap<PromptApiMap>;
