/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as `gateway-api.ts`,
 * `governance-api.ts`, `automation-api.ts`, `ops-api.ts`, `agent-api.ts`,
 * `data-retention-api.ts`, `dataset-api.ts`, `model-provider-api.ts`,
 * `authz-api.ts` and `annotation-api.ts` say of their own maps: the procedures
 * are mounted by the process out of `@langwatch/api-key-server`, which a web
 * package may not import even for a type, and the router type does not exist
 * until a process instantiates it. Emitting this file from the mounted router is
 * the fix; writing it by hand is the interim, and it is honest because every
 * payload below is a contract's own.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `apiKey`, `project` and `organization` are
 * mount points on the root router and tRPC hashes that path into the React Query
 * cache key; spell one differently and these hooks quietly stop sharing a cache
 * with the `api.apiKey.*` call sites that have not moved — of which there are
 * several, because the trace drawer's API key attribute, the me-family
 * credential cards and Langy's key checks all still read them.
 *
 * ## NO KEY MATERIAL IS ON ANY READ BELOW
 *
 * `apiKey.list` answers {@link ApiKeyListEntry}, whose `lookupIdPrefix` is five
 * characters of the PUBLIC lookup id and not a prefix of any secret. Exactly two
 * shapes in this map carry a credential, and both are MINTS rather than reads:
 * `apiKey.create` hands the plaintext token back once, at the moment of minting,
 * and `project.regenerateApiKey` hands back the freshly rotated legacy project
 * key. Both feed the one-time dialog and neither has a matching read. If a
 * future read needs a token on this map, that is a wire change and a decision,
 * not an addition — `api-key-api.unit.test.ts` asserts the shape of this
 * boundary so widening it is deliberate.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package. Recorded here so the finding it
 * raises is a decision rather than a surprise.
 */

import type {
  ApiKeyListEntry,
  ApiKeyProject,
  ApiKeyTeam,
  ApiKeyUser,
  NamedApiKeyBinding,
} from "@langwatch/api-key-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

/** The organization every API key procedure is narrowed to. */
type OrganizationScope = { organizationId: string };

/** One scope a key write names. */
type ApiKeyBindingWrite = {
  role: string;
  scopeType: string;
  scopeId: string;
};

export type ApiKeyApiMap = {
  apiKey: {
    /**
     * The organization's keys for an admin, the caller's own for everyone
     * else. Never a secret — see the note above.
     */
    list: {
      query: { input: OrganizationScope; output: ApiKeyListEntry[] };
    };

    /**
     * The CALLER's own role bindings in one organization: the ceiling a key
     * they mint can never exceed. Both drawers and the CLI authorize screen
     * mirror it, so a form can never offer a permission the mint would refuse.
     */
    myBindings: {
      query: { input: OrganizationScope; output: NamedApiKeyBinding[] };
    };

    /** The projects the scope picker offers. */
    orgProjects: {
      query: { input: OrganizationScope; output: ApiKeyProject[] };
    };

    /** The teams the scope picker offers. */
    orgTeams: {
      query: { input: OrganizationScope; output: ApiKeyTeam[] };
    };

    /**
     * The organization's members, for the "create this key for someone else"
     * picker. ANSWERS AN EMPTY LIST FOR A NON-ADMIN, which is how the page
     * knows whether the reader is an organization admin without asking a
     * second question — the platform page derived `isAdmin` from exactly this.
     */
    orgMembers: {
      query: { input: OrganizationScope; output: ApiKeyUser[] };
    };

    /**
     * Mints a key. THE ONLY PROCEDURE IN THE PRODUCT THAT EVER ANSWERS A
     * PLAINTEXT API TOKEN, and it answers it once. Nothing stores it and no
     * read returns it, so a reader who loses it revokes and mints again — which
     * is why the dialog this feeds is the one-time reveal.
     */
    create: {
      mutation: {
        input: OrganizationScope & {
          name: string;
          description?: string;
          expiresAt?: Date;
          permissionMode: string;
          keyType: "personal" | "service";
          assignedToUserId?: string;
          permissions?: string[];
          bindings: ApiKeyBindingWrite[];
        };
        output: {
          token: string;
          apiKey: { id: string; name: string; createdAt: Date };
        };
      };
    };

    update: {
      mutation: {
        input: OrganizationScope & {
          apiKeyId: string;
          name?: string;
          description?: string | null;
          permissionMode?: string;
          permissions?: string[];
          bindings?: ApiKeyBindingWrite[];
        };
        output: { id: string; name: string; permissionMode: string };
      };
    };

    revoke: {
      mutation: {
        input: OrganizationScope & { apiKeyId: string };
        output: { success: boolean };
      };
    };
  };

  project: {
    /**
     * Rotates the LEGACY project base key and hands back the new one, once.
     * The rotation is a single atomic update plus an audit row server-side, so
     * by the time this answers the previous key is already dead.
     */
    regenerateApiKey: {
      mutation: { input: { projectId: string }; output: { apiKey: string } };
    };

    /**
     * Whether the project has ever received a trace. The CLI onboarding watch
     * polls it after an approval so a first-time reader lands on their own
     * session rather than on an empty page.
     */
    getHasFirstMessage: {
      query: { input: { projectId: string }; output: { firstMessage: boolean } };
    };
  };

  organization: {
    /**
     * The organization graph, asked with the same input the application shell
     * asks with — under tRPC's path-plus-input cache key that is the same
     * entry, so the graph is fetched once for the document however many halves
     * of the product want it.
     *
     * Read for the CLI project picker (which needs `ownerUserId`, `isPersonal`,
     * `kind` and `slug`, none of which the scope filter cares about) and
     * invalidated after a legacy project key rotation, because the row the
     * table renders sources `project.apiKey` from this graph.
     */
    getAll: { query: { input: { isDemo?: boolean }; output: unknown } };
  };
};

/**
 * The API Key family's typed tRPC hooks. Same machinery, same transport and
 * same React Query cache as the application's `api` proxy — see
 * `createFeatureApi` for why separate instances still share cache entries.
 *
 * INTERNAL to this package by convention: the screens call it, and the process
 * shell mounts `apiKeyApi.Provider`.
 */
export const apiKeyApi = createFeatureApi<ApiKeyApiMap>();
