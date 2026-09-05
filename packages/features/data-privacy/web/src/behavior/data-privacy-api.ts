/**
 * The procedures this package calls, and the hooks that call them.
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
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
        output: undefined;
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
