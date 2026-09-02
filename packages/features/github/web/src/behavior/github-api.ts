/**
 * The procedures the Integrations screen calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as every other feature
 * family's map says of itself: the procedures are mounted by the process out of
 * `@langwatch/github-server`, which a web package may not import even for a
 * type, and the router type does not exist until a process instantiates one.
 *
 * THE SEGMENT NAME IS LOAD-BEARING. `github` is the mount point on the root
 * router and tRPC hashes that path into the React Query cache key; spell it
 * differently and these hooks quietly stop sharing a cache with the
 * `api.github.*` call sites that have NOT moved — the coding-agent surfaces
 * among them.
 *
 * THE OUTPUTS ARE THE PRODUCER'S OWN TYPES. `GithubConnectionStatus` and
 * `GithubDisconnectResult` are `@langwatch/github-contract`'s, and
 * `GithubConnectionService` is annotated with both. The platform page restated
 * the installation row as a local `Installation` type with the same seven
 * fields; naming the contract instead is what keeps a field the server adds
 * from being invisible here.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package.
 */

import type { GithubConnectionStatus, GithubDisconnectResult } from "@langwatch/github-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

export type GithubApiMap = {
  github: {
    /**
     * Whether this instance can start an installation at all, which GitHub
     * accounts the organization already reaches, and where an install starts.
     */
    getConnectionStatus: {
      query: { input: { organizationId: string }; output: GithubConnectionStatus };
    };

    /**
     * Drops the local record and hands back the deep link a human follows.
     *
     * GitHub cannot be uninstalled through the API, so this is half of the
     * ceremony: the webhook removes the row once GitHub confirms.
     */
    disconnect: {
      mutation: {
        input: { organizationId: string; installationId: string };
        output: GithubDisconnectResult;
      };
    };
  };
};

/**
 * The GitHub family's typed tRPC hooks. Same machinery, same transport and same
 * React Query cache as the application's `api` proxy — see `createFeatureApi`
 * for why separate instances still share cache entries.
 */
export const githubApi = createFeatureApi<GithubApiMap>();
