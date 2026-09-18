/**
 * The shell's by-path dispatcher. Cache key is `trpcQueryKey`'s, so a dispatch
 * here and a typed hook share ONE entry. The `UiRpc` port and `useUiRpc` are
 * the host's capability; this is its one implementation.
 */

import { trpcQueryKey } from "@langwatch/api/web";
import {
  UiRpc,
  type UiRpcSubscription,
  type UiRpcSubscriptionHandlers,
} from "@langwatch/browser-host/capabilities";
import type { QueryClient } from "@tanstack/react-query";

import type { UiFeatureApiTransport } from "./ui-feature-transport";

export {
  UiRpc,
  useUiRpc,
  type UiRpcSubscription,
  type UiRpcSubscriptionHandlers,
} from "@langwatch/browser-host/capabilities";

export class BrowserUiRpc extends UiRpc {
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
      queryKey: trpcQueryKey(path, { input, type: "query" }),
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
