/**
 * What the topic-clustering screen asks of the application it is mounted in.
 *
 * The same port shape every settings family since governance has written:
 * declared here without importing anything of the composing application's, so
 * everything the platform page read off `useOrganizationTeamProject` and the
 * toaster arrives through these methods and the screen moves with its
 * `topicApi.x.y.useQuery` call sites unchanged.
 *
 * NOTHING HERE FETCHES. A host is a value object over what the application has
 * already resolved, which is what lets a test construct one.
 */

import { createContext, useContext } from "react";

/** The project every clustering read is scoped to. */
export type TopicHostProject = {
  id: string;
};

/** A short confirmation of a run the reader just asked for. */
export type TopicSuccessNotice = {
  title: string;
  description?: string;
};

/**
 * A failure, as the screen knows it.
 *
 * The raw `error` travels, never a sentence the screen composed: the words a
 * customer reads are resolved from the error's `code` by the host's
 * presentation registry (#5984). `fallbackTitle` names the action that failed.
 * `description` is the screen's own copy for a refusal that carries no code,
 * which is what the platform page wrote inline — the server's message for a
 * clustering trigger is a fixed sentence and deliberately not echoed.
 */
export type TopicFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  description?: string;
};

export abstract class TopicHostPort {
  /** The project in scope, or undefined before one resolves. */
  abstract project(): TopicHostProject | undefined;

  abstract succeeded(notice: TopicSuccessNotice): void;

  abstract failed(failure: TopicFailureNotice): void;
}

const TopicHostContext = createContext<TopicHostPort | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const TopicHostProvider = TopicHostContext.Provider;

/**
 * The host this screen is mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useTopicHost(): TopicHostPort {
  const host = useContext(TopicHostContext);
  if (!host) {
    throw new Error(
      "No topic host is mounted above this screen; render it inside the topic frontend feature.",
    );
  }
  return host;
}
