/**
 * The procedures the Langy dock calls, and the two ways it calls them.
 */

import type {
  LangyConversationListCursorDto,
  LangyConversationListItemDto,
} from "@langwatch/langy-contract";
import type { ModelDefaultResolvedTrpcOutput } from "@langwatch/model-provider-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

/**
 * A payload no contract package publishes yet.
 */
// oxlint-disable-next-line no-explicit-any
type Unpublished = any;

type Q = { query: { input: Unpublished; output: Unpublished } };

/**
 * A LIST procedure, stated as a list.
 */
type QL = { query: { input: Unpublished; output: Unpublished[] } };
type M = { mutation: { input: Unpublished; output: Unpublished } };
type S = { subscription: { input: Unpublished; output: Unpublished } };

export type LangyApiMap = {
  langy: {
    /**
     * The conversation list, paged.
     */
    list: {
      query: {
        input: {
          projectId: string;
          limit?: number;
          cursor?: LangyConversationListCursorDto;
        };
        output: {
          items: LangyConversationListItemDto[];
          nextCursor: LangyConversationListCursorDto | null;
        };
      };
    };
    messages: Q;
    modelsAllowed: Q;
    createConversation: M;
    continueConversation: M;
    renameConversation: M;
    deleteConversation: M;
    stopTurn: M;
    warmWorker: M;
    recordFeedback: M;
    feedbackPromptShown: M;
    claimUiAction: M;
    completeUiAction: M;
    /** One block of an answer, as the model produces it. */
    onTurnStream: S;
    /** One notice that a conversation moved, for a tab that is not driving it. */
    onConversationUpdate: S;
    /** The durable fold, from a cursor — what a reconnecting tab catches up on. */
    conversationEventsAfter: Q;
  };

  /**
   * THE BORROWED VOCABULARY, one segment per feature the dock reaches.
   */
  modelProvider: {
    getResolvedDefault: {
      query: {
        input: { projectId: string; featureKey: string };
        output: ModelDefaultResolvedTrpcOutput;
      };
    };
    setFeatureOverrideForScope: M;
    setRoleAssignmentForScope: M;
  };
  /**
   * The workspace graph, narrowed to what this family needs.
   */
  organization: {
    getAll: {
      query: {
        input: { isDemo?: boolean };
        output: Array<{
          id: string;
          name: string;
          slug?: string;
          teams: Array<{
            id: string;
            name: string;
            slug?: string;
            isPersonal?: boolean;
            ownerUserId?: string | null;
            members?: Array<{ userId: string }>;
            projects: Array<{
              id: string;
              name: string;
              slug: string;
              apiKey?: string;
              firstMessage?: boolean;
            }>;
          }>;
        }>;
      };
    };
  };
  dashboards: { getAll: QL; create: M };
  graphs: { create: M };
  /** Whether the project has been connected to anything, for the panel's asks. */
  integrationsChecks: { getCheckStatus: Q };
  /** The connect-your-repository card the GitHub skill offers. */
  github: { getConnectionStatus: Q; getInstallation: Q; getRepositories: QL; setRepository: M };
  /** The rows a capability card hydrates fresh, rather than trusting the turn's copy. */
  tracesV2: { list: Q; header: Q; discover: Q };
  dataset: { getAll: QL; getById: Q };
  prompts: { getAllPromptsForProject: QL; getByIdOrHandle: Q };
  experiments: { getAllByProjectId: QL; getExperimentBySlug: Q };
};

/** What each procedure in the map takes. */
export type RouterInputs = { [K in keyof LangyApiMap]: InputsOf<LangyApiMap[K]> };

/** What each procedure in the map answers. */
export type RouterOutputs = { [K in keyof LangyApiMap]: OutputsOf<LangyApiMap[K]> };

type InputsOf<TNode> = TNode extends { query: { input: infer TIn } }
  ? TIn
  : TNode extends { mutation: { input: infer TIn } }
    ? TIn
    : TNode extends { subscription: { input: infer TIn } }
      ? TIn
      : { [K in keyof TNode]: InputsOf<TNode[K]> };

type OutputsOf<TNode> = TNode extends { query: { output: infer TOut } }
  ? TOut
  : TNode extends { mutation: { output: infer TOut } }
    ? TOut
    : TNode extends { subscription: { output: infer TOut } }
      ? TOut
      : { [K in keyof TNode]: OutputsOf<TNode[K]> };

export const api = createFeatureApi<LangyApiMap>();

/** The same object, under the name the process shell mounts it by. */
export const langyApi = api;

/**
 * The one untyped client the shell built, as this package addresses it.
 */
type UntypedClient = {
  mutation: (path: string, input?: unknown, opts?: unknown) => Promise<unknown>;
  query: (path: string, input?: unknown, opts?: unknown) => Promise<unknown>;
  subscription: (path: string, input: unknown, opts: unknown) => { unsubscribe: () => void };
};

let untyped: UntypedClient | undefined;

/** Called by the application when it mounts this family's transport. */
export function setLangyTrpcClient(client: unknown): void {
  untyped = client as UntypedClient | undefined;
}

function callUntyped(kind: keyof UntypedClient, path: string, args: unknown[]): unknown {
  if (!untyped) {
    throw new Error(
      `Langy called ${path} before the application handed it a transport. ` +
        "Call setLangyTrpcClient from the feature's host provider.",
    );
  }
  if (kind === "subscription") {
    return untyped.subscription(path, args[0], args[1]);
  }
  return untyped[kind](path, args[0], args[1]);
}

/**
 * `trpcClient.langy.onTurnStream.subscribe(input, opts)`, unchanged.
 */
function addressProxy(prefix: string[]): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(_target, property: string) {
        if (property === "mutate") {
          return (...args: unknown[]) => callUntyped("mutation", prefix.join("."), args);
        }
        if (property === "query") {
          return (...args: unknown[]) => callUntyped("query", prefix.join("."), args);
        }
        if (property === "subscribe") {
          return (...args: unknown[]) => callUntyped("subscription", prefix.join("."), args);
        }
        return addressProxy([...prefix, property]);
      },
    },
  );
}

// oxlint-disable-next-line no-explicit-any
export const trpcClient: any = addressProxy([]);
