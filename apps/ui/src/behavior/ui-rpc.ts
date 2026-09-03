/**
 * Dispatching a procedure BY NAME — for surfaces (like the Agents port)
 * covering many procedures behind one path-string adapter. Cache key is
 * `trpcQueryKey`'s, so a dispatch here and a typed hook share ONE entry.
 */

import { trpcQueryKey } from "@langwatch/platform-api-client";
import type { QueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import type { UiFeatureApiTransport } from "./ui-feature-transport";

/** What a live procedure hands its subscriber, one entry at a time. */
export type UiRpcSubscriptionHandlers = {
  onData?: (value: unknown) => void;
  onError?: (error: unknown) => void;
  onStarted?: () => void;
  onStopped?: () => void;
};

/** A live procedure, while somebody is listening to it. */
export type UiRpcSubscription = { unsubscribe: () => void };

/** A procedure call addressed by path rather than by a typed hook. */
export abstract class UiRpcPort {
  abstract query(path: string, input: unknown): Promise<unknown>;

  abstract mutate(path: string, input: unknown): Promise<unknown>;

  /**
   * A LIVE procedure, opened from outside React — Langy bridges
   * `langy.onTurnStream` into a `ReadableStream` a plain async function
   * reads, on the SAME transport/SSE lane. Nothing is cached.
   */
  abstract subscribe(
    path: string,
    input: unknown,
    handlers: UiRpcSubscriptionHandlers,
  ): UiRpcSubscription;
}

export class BrowserUiRpc extends UiRpcPort {
  static create(input: {
    transport: UiFeatureApiTransport;
    queryClient: QueryClient;
  }): BrowserUiRpc {
    return new BrowserUiRpc(input.transport, input.queryClient);
  }

  private constructor(
    private readonly transport: UiFeatureApiTransport,
    private readonly queryClient: QueryClient,
  ) {
    super();
  }

  query(path: string, input: unknown): Promise<unknown> {
    return this.queryClient.fetchQuery({
      queryKey: trpcQueryKey(path, { input, type: "query" }) as unknown as readonly unknown[],
      queryFn: () => this.transport.query(path, input),
    });
  }

  subscribe(path: string, input: unknown, handlers: UiRpcSubscriptionHandlers): UiRpcSubscription {
    return this.transport.subscription(path, input, handlers);
  }

  async mutate(path: string, input: unknown): Promise<unknown> {
    const output = await this.transport.mutation(path, input);
    // Everything, because this dispatches whatever procedure the caller names
    // and has no way to know what a given mutation touched. The narrow filter
    // that looked more careful only ever matched this dispatcher's own private
    // cache, so the page behind it never refreshed at all.
    await this.queryClient.invalidateQueries();
    return output;
  }
}

/** The composition never mounted a shell, and something asked to dispatch. */
class UnavailableUiRpc extends UiRpcPort {
  query(): never {
    throw new Error(
      "No UI transport is mounted above this screen; render it inside the application shell.",
    );
  }

  mutate(): never {
    throw new Error(
      "No UI transport is mounted above this screen; render it inside the application shell.",
    );
  }

  subscribe(): never {
    throw new Error(
      "No UI transport is mounted above this screen; render it inside the application shell.",
    );
  }
}

const UiRpcContext = createContext<UiRpcPort>(new UnavailableUiRpc());

/** Publishes the shell's dispatcher to every routed page. */
export const UiRpcContextProvider = UiRpcContext.Provider;

/** The by-path dispatcher of the process this screen is running in. */
export function useUiRpc(): UiRpcPort {
  return useContext(UiRpcContext);
}
