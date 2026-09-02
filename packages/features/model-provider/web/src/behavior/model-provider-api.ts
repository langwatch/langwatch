/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as `gateway-api.ts`,
 * `governance-api.ts`, `automation-api.ts`, `ops-api.ts`, `agent-api.ts`,
 * `data-retention-api.ts` and `dataset-api.ts` say of their own maps: the
 * procedures are mounted by the process out of
 * `@langwatch/model-provider-server`, which a web package may not import even
 * for a type, and the router type does not exist until a process instantiates
 * it. Emitting this file from the mounted router is the fix; writing it by hand
 * is the interim, and it is honest because every payload below is
 * `@langwatch/model-provider-contract`'s own.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `modelProvider`, `llmModelCost` and
 * `organization` are mount points on the root router and tRPC hashes that path
 * into the React Query cache key; spell one differently and these hooks quietly
 * stop sharing a cache with the `api.modelProvider.*` call sites that have not
 * moved — of which there are many, because the provider editor drawer, the
 * model-cost drawer and the default-model override drawer are all still
 * `platform/app`'s.
 *
 * NO CREDENTIAL VALUE APPEARS ON ANY SHAPE BELOW, and that is a property rather
 * than an accident. The list procedures answer `ModelProviderListEntry`, whose
 * `customKeys` is the record the service has already masked, and
 * `testConnection` takes a ROW ID and answers a verdict — the stored credential
 * is never sent to the browser and never sent back.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package. Recorded here so the finding it
 * raises is a decision rather than a surprise.
 */

import type {
  ModelCost,
  ModelDefaultSnapshot,
  ModelProviderCredentialVerdict,
  ModelProviderListEntry,
} from "@langwatch/model-provider-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

/** The project every project-scoped procedure is narrowed to. */
type ProjectScope = { projectId: string };

/**
 * The tenant a provider write names.
 *
 * Either handle is enough and a project is only the narrower one: a provider
 * belongs to the organization and reaches the scopes attached to it, so an
 * organization on the agent-governance track can manage providers without ever
 * having created a project. The server's own input schema says the same thing
 * with `requireModelProviderTenantAnchor`.
 */
type TenantAnchor = { projectId?: string; organizationId?: string };

export type ModelProviderApiMap = {
  modelProvider: {
    /**
     * Every stored row in the project, flat — one entry per row, never deduped
     * by provider type. A member without `organization:view` reads this one.
     */
    listAllForProjectForFrontend: {
      query: { input: ProjectScope; output: ModelProviderListEntry[] };
    };

    /**
     * The same list fanned out across the whole organization, so an admin sees
     * providers a sibling project has configured.
     */
    listAllForOrganizationForFrontend: {
      query: { input: { organizationId: string }; output: ModelProviderListEntry[] };
    };

    /**
     * Whether the credential ALREADY STORED on a row still works.
     *
     * The row id goes out; nothing here sends a key. Three verdicts come back
     * and the third is the point — "we could not check this" is an answer, not
     * a soft yes.
     */
    testConnection: {
      mutation: {
        input: TenantAnchor & { modelProviderId: string };
        output: ModelProviderCredentialVerdict;
      };
    };

    delete: {
      mutation: {
        input: TenantAnchor & { id?: string; provider: string };
        output: unknown;
      };
    };

    /** Every default-model policy the caller can see, plus the cascade inputs. */
    getDefaultModelsForProject: {
      query: { input: ProjectScope; output: ModelDefaultSnapshot };
    };

    deleteDefaultModelsConfig: {
      mutation: { input: { id: string }; output: unknown };
    };

    /**
     * Declared for its cache entry rather than for a call.
     *
     * These four are read by surfaces that have NOT moved — the prompts page,
     * the evaluation wizard, Langy's model pill — and gate their UI on "are
     * there enabled providers?". Deleting a provider or a default-model policy
     * has to invalidate them or those surfaces keep the deleted row until a
     * window-focus refetch. `useUtils()` is scoped to this map, so naming them
     * here is what lets this package reach the entries the application's own
     * `api.modelProvider.*` hooks created.
     */
    getAllForProject: { query: { input: ProjectScope; output: unknown } };
    getAllForProjectForFrontend: { query: { input: ProjectScope; output: unknown } };
    getResolvedDefault: {
      query: { input: ProjectScope & { featureKey: string }; output: unknown };
    };
  };

  llmModelCost: {
    /** The cost rules the project's settings page renders. */
    getAllForProject: {
      query: { input: ProjectScope; output: ModelCost[] };
    };

    delete: {
      mutation: { input: ProjectScope & { id: string }; output: unknown };
    };
  };

  organization: {
    /**
     * Declared for its cache entry, like the four above.
     *
     * Deleting a provider changes the organization graph the shell holds (a
     * project's provider count is part of it), so the platform page invalidated
     * this alongside the provider lists. Same entry the application shell's own
     * read lands on, because tRPC keys on the procedure path.
     */
    getAll: { query: { input: { isDemo?: boolean }; output: unknown } };
  };
};

/**
 * The Model Provider family's typed tRPC hooks. Same machinery, same transport
 * and same React Query cache as the application's `api` proxy — see
 * `createFeatureApi` for why separate instances still share cache entries.
 *
 * INTERNAL to this package by convention: the screens call it, and the process
 * shell mounts `modelProviderApi.Provider`.
 */
export const modelProviderApi = createFeatureApi<ModelProviderApiMap>();
