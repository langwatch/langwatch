/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, for the reason every family's
 * map before this one gives: the procedures are mounted by the process out of
 * modules a web package may not import even for a type, and the router type
 * does not exist until a process instantiates it. Every payload below is
 * `@langwatch/data-privacy-contract`'s own, which is what makes writing it by
 * hand honest.
 *
 * THE SEGMENT NAME IS LOAD-BEARING. `dataPrivacy` is a mount point on the root
 * router and tRPC hashes that path into the React Query cache key; spell it
 * differently and these hooks quietly stop sharing a cache with the
 * `api.dataPrivacy.*` call sites that have not moved.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package.
 */

import type {
  DataPrivacyConfig,
  DataPrivacyScopeType,
  DataPrivacySnapshot,
} from "@langwatch/data-privacy-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

/** One scope a rule is written at. */
type PrivacyScopeInput = { scopeType: DataPrivacyScopeType; scopeId: string };

/** The project every data-privacy procedure is scoped to. */
type ProjectScope = { projectId: string };

export type DataPrivacyApiMap = {
  dataPrivacy: {
    /** The effective policy, the readable rules, and the writable scopes. */
    getSnapshot: {
      query: { input: ProjectScope; output: DataPrivacySnapshot };
    };

    setForScope: {
      mutation: {
        input: ProjectScope & {
          scope: PrivacyScopeInput;
          personalOnly: boolean;
          config: DataPrivacyConfig;
        };
        output: unknown;
      };
    };

    removeForScope: {
      mutation: {
        input: ProjectScope & { scope: PrivacyScopeInput; personalOnly: boolean };
        output: void;
      };
    };
  };
};

/**
 * The Data Privacy family's typed tRPC hooks. Same machinery, same transport
 * and same React Query cache as the application's `api` proxy — see
 * `createFeatureApi` for why separate instances still share cache entries.
 */
export const dataPrivacyApi = createFeatureApi<DataPrivacyApiMap>();
