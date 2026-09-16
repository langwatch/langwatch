// Topic-clustering screen's port: declared without importing the composing application,
// so everything the platform page resolved arrives through methods and call sites unchanged.

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

// A failure as the screen knows it: raw `error` travels, words resolved from error's `code`
// by host's presentation registry (#5984); `fallbackTitle` names the failed action.
export type TopicFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  description?: string;
};

export abstract class TopicHostApi {
  /** The project in scope, or undefined before one resolves. */
  abstract project(): TopicHostProject | undefined;

  abstract succeeded(notice: TopicSuccessNotice): void;

  abstract failed(failure: TopicFailureNotice): void;
}

const TopicHostContext = createContext<TopicHostApi | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const TopicHostProvider = TopicHostContext.Provider;

/**
 * The host this screen is mounted in. Missing means it was rendered outside
 * the frontend feature that owns it — a composition fault, not something a
 * screen can degrade around.
 */
export function useTopicHost(): TopicHostApi {
  const host = useContext(TopicHostContext);
  if (!host) {
    throw new Error(
      "No topic host is mounted above this screen; render it inside the topic frontend feature.",
    );
  }
  return host;
}
