/**
 * The procedures the Langy dock calls, and the two ways it calls them.
 */

import { createModuleApi, type ContractApiMap, type OutputsFromMap } from "@langwatch/api/web";
import type {
  LangyConversationListCursorDto,
  LangyConversationListItemDto,
} from "@langwatch/langy-contract";
import type { modelProviderTrpc } from "@langwatch/model-provider-contract";
import type { tracesTrpc } from "@langwatch/trace-contract";

/** A borrowed procedure's payload, where its owner's contract is not yet a dependency. */
type Unpublished = any;

type Q = { query: { input: Unpublished; output: Unpublished } };
type QL = { query: { input: Unpublished; output: Unpublished[] } };
type M = { mutation: { input: Unpublished; output: Unpublished } };
type S = { subscription: { input: Unpublished; output: Unpublished } };

/** Procedures whose owner's contract is not a dependency of this package yet. */
type BorrowedProcedures = {
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
    /** One conversation, for the follow-along deep link. */
    detail: Q;
    /** Every card the developer's machine raised in one conversation (ADR-129). */
    localRecord: Q;
    /** Whether a folder is shared with this conversation right now. */
    getLocalWorkspace: Q;
    /** The developer's answer to one permission card. */
    answerLocalPermission: M;
    /** A session grant for the pattern the card named. */
    setLocalPolicy: M;
    /** The developer's answer to a question card. */
    answerQuestion: M;
    /** Release the shared folder from the panel. */
    disconnectLocalWorkspace: M;
    /** Remember the pull-request path for this person, so Langy stops asking. */
    setCodeAccessPreference: M;
    /** The answer already remembered, for the Integrations screen. */
    getCodeAccessPreference: Q;
  };

  /**
   * The workspace graph, narrowed to what this family needs.
   */
  organization: {
    getAll: {
      query: {
        input: { isDemo?: boolean };
        output: {
          id: string;
          name: string;
          slug?: string;
          teams: {
            id: string;
            name: string;
            slug?: string;
            isPersonal?: boolean;
            ownerUserId?: string | null;
            members?: { userId: string }[];
            projects: {
              id: string;
              name: string;
              slug: string;
              apiKey?: string;
              firstMessage?: boolean;
            }[];
          }[];
        }[];
      };
    };
  };
  dashboards: { getAll: QL; create: M };
  /** The widgets a turn's dashboard mutation invalidates on completion. */
  dashboardWidgets: { list: QL };
  /** The dashboard graphs a turn's widget mutation invalidates on completion. */
  graphs: { create: M; getAll: QL };
  /** Whether the project has been connected to anything, for the panel's asks. */
  integrationsChecks: { getCheckStatus: Q };
  /** The connect-your-repository card the GitHub skill offers. */
  github: { getConnectionStatus: Q; getInstallation: Q; getRepositories: QL; setRepository: M };
  dataset: { getAll: QL; getById: Q };
  prompts: { getAllPromptsForProject: QL; getByIdOrHandle: Q };
  experiments: { getAllByProjectId: QL; getExperimentBySlug: Q };
  /** The one-time reveal the secret snippet card spends; a mutation, since reading destroys it. */
  secrets: { revealOnce: M };
};

export type LangyApiMap = ContractApiMap<typeof modelProviderTrpc> &
  ContractApiMap<typeof tracesTrpc> &
  BorrowedProcedures;

/** What each procedure in the map answers, as the browser receives it. */
export type RouterOutputs = OutputsFromMap<LangyApiMap>;

export const api = createModuleApi<LangyApiMap>();

/** The same object, under the name the process shell mounts it by. */
export const langyApi = api;

/** The typed imperative client the api's provider carries, for code that runs outside a hook. */
export type LangyTrpcClient = ReturnType<typeof api.useUtils>["client"];
