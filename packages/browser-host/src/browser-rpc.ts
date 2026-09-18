/**
 * The shell's by-path dispatcher. Cache key is `trpcQueryKey`'s, so a dispatch
 * here and a typed hook share ONE entry. The `UiRpc` port and `useUiRpc` are
 * the host's capability; this is its one implementation.
 */

import { trpcQueryKey } from "@langwatch/api/web";
import type { QueryClient } from "@tanstack/react-query";

import { UiRpc, type UiRpcSubscription, type UiRpcSubscriptionHandlers } from "./capabilities";
import type { UiFeatureApiTransport } from "./transport";

/** The three lanes this dispatcher uses, so a caller hands the narrowest thing. */
export type UiRpcTransport = Pick<UiFeatureApiTransport, "query" | "mutation" | "subscription">;

export class BrowserUiRpc extends UiRpc {
  static create(input: { transport: UiRpcTransport; queryClient: QueryClient }): BrowserUiRpc {
    return new BrowserUiRpc(input.transport, input.queryClient);
  }

  private constructor(
    private readonly transport: UiRpcTransport,
    private readonly queryClient: QueryClient,
  ) {
    super();
  }

  /**
   * The transport directly, then published under the shared key. NOT
   * `fetchQuery`, which joins the caller's own in-flight fetch and deadlocks
   * it. specs/ui/by-path-dispatch.feature.
   */
  async query(path: string, input: unknown): Promise<unknown> {
    const answer = await this.transport.query(path, input);
    this.queryClient.setQueryData(trpcQueryKey(path, { input, type: "query" }), answer);
    return answer;
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
