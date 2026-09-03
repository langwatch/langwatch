/**
 * The procedures the Langy dock calls, and the two ways it calls them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as `trace-api.ts`,
 * `workflow-api.ts` and every other family's map say of themselves: the
 * procedures are mounted by the process out of `@langwatch/langy-server` and
 * `@langwatch/model-provider-server`, which a web package may not import even
 * for a type, and the router type does not exist until a process instantiates
 * it.
 *
 * TWO LIVE PROCEDURES, AND THEY ARE THE FEATURE. `langy.onTurnStream` carries
 * every block of an answer as the model produces it, and
 * `langy.onConversationUpdate` is what makes a second tab notice the first
 * one's turn. Both are declared as `subscription`, both ride the SSE lane the
 * shell's transport routes them onto, and neither call site changed.
 *
 * THE VANILLA CLIENT IS KEPT, AND ON PURPOSE. `langyChatTransport` drives one
 * turn from outside React — it bridges `langy.onTurnStream` into a
 * `ReadableStream<UIMessageChunk>` that `useChat` reads — so it cannot use a
 * hook, and `platform/app` gave it the application's vanilla tRPC client. The
 * same wire is kept here: the composing application hands this package the ONE
 * untyped client its hooks already run on, and `trpcClient` is a thin address
 * over it. A second client would mean a second SSE lane and a second cookie
 * story.
 */

import type {
  LangyConversationListCursorDto,
  LangyConversationListItemDto,
} from "@langwatch/langy-contract";
import type { ModelDefaultResolvedTrpcOutput } from "@langwatch/model-provider-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

/**
 * A payload no contract package publishes yet.
 *
 * The convention the studio family introduced: a procedure whose row type
 * still lives in the application's Prisma client gets `any` rather than a
 * guess, so a call site keeps compiling and the debt is NAMED rather than
 * hidden.
 */
// oxlint-disable-next-line no-explicit-any
type Unpublished = any;

type Q = { query: { input: Unpublished; output: Unpublished } };

/**
 * A LIST procedure, stated as a list.
 *
 * `Unpublished` is `any`, and `any` gives a `.map` callback no contextual type
 * at all, so every iteration of a placeholder result is an implicit-any error
 * under `strict`. `Unpublished[]` costs the same nothing in precision and hands
 * the callback its parameter.
 */
type QL = { query: { input: Unpublished; output: Unpublished[] } };
type M = { mutation: { input: Unpublished; output: Unpublished } };
type S = { subscription: { input: Unpublished; output: Unpublished } };

export type LangyApiMap = {
  langy: {
    /**
     * The conversation list, paged.
     *
     * The input is stated rather than left `Unpublished` because the history
     * panel calls `useInfiniteQuery`, and tRPC only decorates a procedure with
     * that hook when its input carries a cursor.
     *
     * The cursor and the row are `@langwatch/langy-contract`'s own DTOs, which
     * is what the transport already annotates this procedure with, so nothing
     * here is a guess or a restatement of a server row.
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
   *
   * Every path is the path the call site already wrote as `api.x.y`, kept
   * letter for letter so a Langy query and the same query fired from a page the
   * application still serves land on ONE React Query cache entry.
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
   *
   * Read by the frontend feature that mounts these screens rather than by a
   * screen, and declared here so it lands on the same cache entry as the
   * application shell's own read of it — one fetch for the document, however
   * many halves of the product want it.
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
 *
 * Set once by the composing application, next to the Provider it mounts for
 * the hooks above — the same client, so one HTTP batching lane and one SSE
 * lane serve both.
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
 *
 * An untyped tRPC client dispatches on a PATH STRING; the dotted address is
 * what the call sites already write, so this walks the path and hands the
 * segments back joined. Deliberately a proxy rather than a hand-written object:
 * the map above is the list of procedures, and a second list here would be a
 * second place for it to drift.
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
