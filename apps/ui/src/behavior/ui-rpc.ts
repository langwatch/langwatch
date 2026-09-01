/**
 * Dispatching a procedure BY NAME, on this application's transport.
 *
 * The typed feature hooks are the ordinary way a screen reads: a package writes
 * its procedures as a map and calls them as `x.y.useQuery(...)`. A few surfaces
 * cannot, and the Agents browser port is the one this was written for — it
 * covers eleven procedures behind one adapter that takes a path string, which is
 * what lets the whole family move without eleven map entries and eleven promises
 * about a router nothing checks yet.
 *
 * IT LIVES IN THE GLOBAL LAYER BECAUSE THAT IS THE ONLY PLACE IT MAY. Building
 * this means holding the tRPC client and the QueryClient, and ADR-004 seals both
 * off from `src/features/*` — a feature that imported them would be a feature
 * choosing its own transport. The shell holds both already, mounts one of these
 * beside the capability ports, and a feature asks for it.
 *
 * THE CACHE KEY IS TRPC'S, and getting that wrong is the bug this module exists
 * to avoid. Keying a read under a namespace of its own — `["agent-ui", path,
 * input]`, which is what the platform host did before it was fixed — shares no
 * prefix with any tRPC key, so an invalidation anywhere else in the product is
 * invisible to it and its own invalidation reaches nothing but itself. The
 * symptom is stale UI that looks random. `trpcQueryKey` is what makes a
 * procedure dispatched here and the same procedure read by a typed hook ONE
 * cache entry.
 */

import { trpcQueryKey } from "@langwatch/platform-api-client";
import type { QueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import type { UiFeatureApiTransport } from "./ui-feature-transport";

/** A procedure call addressed by path rather than by a typed hook. */
export abstract class UiRpcPort {
  abstract query(path: string, input: unknown): Promise<unknown>;

  abstract mutate(path: string, input: unknown): Promise<unknown>;
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
}

const UiRpcContext = createContext<UiRpcPort>(new UnavailableUiRpc());

/** Publishes the shell's dispatcher to every routed page. */
export const UiRpcContextProvider = UiRpcContext.Provider;

/** The by-path dispatcher of the process this screen is running in. */
export function useUiRpc(): UiRpcPort {
  return useContext(UiRpcContext);
}
