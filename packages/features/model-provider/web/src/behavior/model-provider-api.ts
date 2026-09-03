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
  CostRuleMatchingSpansPreview,
  CostRulePreviewInput,
  ModelProviderCodexStatus,
  ModelCost,
  ModelDefaultEffective,
  ModelDefaultInheritedValues,
  ModelDefaultSnapshot,
  ModelProviderCredentialVerdict,
  ModelProviderListEntry,
  ModelProviderScopeType,
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

    /**
     * Saves a credential row, and everything hung off it.
     *
     * TAKES EITHER TENANT HANDLE. A provider belongs to the organization and
     * reaches the scopes attached to it, so an organization on the
     * agent-governance track can manage providers without ever having created a
     * project; `id` present is an edit of that row, absent is a new one.
     *
     * `customKeys` is the only field that carries a secret, and it only ever
     * travels OUTWARD: a key the customer did not retype arrives back from the
     * list already masked, and the editor sends the mask through unchanged so
     * the server knows to leave the stored value alone.
     */
    update: {
      mutation: {
        input: TenantAnchor & {
          id?: string;
          provider: string;
          name?: string;
          enabled: boolean;
          customKeys?: Record<string, unknown> | null;
          customModels?: unknown;
          customEmbeddingsModels?: unknown;
          extraHeaders?: Array<{ key: string; value: string }> | null;
          defaultModel?: string | null;
          routingHandle?: string | null;
          scopes?: Array<{ scopeType: ModelProviderScopeType; scopeId: string }>;
          scopeType?: ModelProviderScopeType;
          scopeId?: string;
          rateLimitRpm?: number | null;
          rateLimitTpm?: number | null;
          rateLimitRpd?: number | null;
          fallbackPriorityGlobal?: number | null;
          providerConfig?: Record<string, unknown> | null;
        };
        output: ModelProviderListEntry;
      };
    };

    /**
     * Probes credentials the customer has just TYPED, before they are stored.
     *
     * A mutation despite changing nothing, and the reason is the input: tRPC
     * sends a query as a GET with its input encoded into the URL, and a secret
     * in a URL is written to access logs, proxy logs and browser history. The
     * server's own procedure says the same thing at more length.
     */
    validateApiKey: {
      mutation: {
        input: TenantAnchor & {
          provider: string;
          customKeys: Record<string, string>;
          scopes?: Array<{ scopeType: ModelProviderScopeType; scopeId: string }>;
        };
        output: ModelProviderCredentialVerdict;
      };
    };

    /**
     * Probes a credential that is ALREADY STORED against a base URL.
     *
     * Nothing secret travels either way: the row id and the URL go out, a
     * verdict comes back. That is what makes it safe as a query, unlike the
     * one above.
     */
    validateKeyWithCustomUrl: {
      query: {
        input: ProjectScope & { provider: string; customBaseUrl?: string };
        output: ModelProviderCredentialVerdict;
      };
    };

    /**
     * Whether the deployment manages this provider's credentials itself.
     *
     * Enterprise deployments can supply a provider centrally, and the editor
     * then renders the managed notice in place of the credential fields rather
     * than inviting a customer to type a key that would be ignored.
     */
    isManagedProvider: {
      query: {
        input: { organizationId?: string; projectId?: string; provider: string };
        output: { managed: boolean };
      };
    };

    /** Whether a Codex account is connected, and on which plan. */
    codexStatus: {
      query: { input: ProjectScope; output: ModelProviderCodexStatus };
    };

    /**
     * Codex sign-in, step 1: ask OpenAI for a device code.
     *
     * Nothing is stored — the pending sign-in's identifiers travel to the
     * browser and come back on every poll, so polling survives a server
     * instance the first call never touched.
     */
    codexSignInStart: {
      mutation: {
        input: ProjectScope;
        output: {
          userCode: string;
          deviceAuthId: string;
          verificationUrl: string;
          intervalSeconds: number;
        };
      };
    };

    /**
     * Codex sign-in, step 2..n: one poll of the pending authorization.
     *
     * Answers `{ status: "pending" }` until the customer approves, then saves
     * the provider row and hands back the account it connected.
     */
    codexSignInPoll: {
      mutation: {
        input: ProjectScope & {
          deviceAuthId: string;
          userCode: string;
          scopes: Array<{ scopeType: ModelProviderScopeType; scopeId: string }>;
          setAsCodingDefaults?: boolean;
        };
        output:
          | { status: "pending" }
          | { status: "complete"; providerId?: string; email: string; plan: string };
      };
    };

    /** Points the coding-assistant roles at the codex model, after the fact. */
    codexApplyCodingDefaults: {
      mutation: {
        input: ProjectScope & {
          scopes: Array<{ scopeType: ModelProviderScopeType; scopeId: string }>;
        };
        output: unknown;
      };
    };

    /**
     * Points ONE role at one model, at one scope.
     *
     * The tactical writer behind the editor's "set as default" checkbox, as
     * against `saveDefaultModelsConfig`, which writes a whole policy. The tier
     * the caller names is what picks the permission, and the SERVICE is what
     * applies it.
     */
    setRoleAssignmentForScope: {
      mutation: {
        input: {
          role: string;
          model: string | null;
          scopeType: ModelProviderScopeType;
          scopeId: string;
        };
        output: unknown;
      };
    };

    /** Every default-model policy the caller can see, plus the cascade inputs. */
    getDefaultModelsForProject: {
      query: { input: ProjectScope; output: ModelDefaultSnapshot };
    };

    /**
     * Writes one default-model policy: the scopes it attaches to, and the
     * role/feature keys it pins.
     *
     * ABSENCE IS THE INHERIT SIGNAL. A key missing from `config` is not "unset
     * to nothing" but "let the cascade answer", so an edit that clears every
     * key deletes the policy rather than storing an empty one — which is why
     * the drawer's own toast has to say "removed" rather than "updated" for
     * that case.
     *
     * Authorized per SCOPE rather than per project: the caller must hold manage
     * on every scope the policy attaches to and on every one it is removed
     * from, so a project admin cannot push a default up to organization level.
     */
    saveDefaultModelsConfig: {
      mutation: {
        input: {
          id?: string;
          config: Record<string, string>;
          scopes: Array<{ scopeType: ModelProviderScopeType; scopeId: string }>;
        };
        output: { id: string };
      };
    };

    /**
     * What the cascade WOULD resolve for these scopes if this policy did not
     * exist.
     *
     * Drives the drawer's ghosted inherit placeholder and its "Inherit (from
     * organization)" dropdown entry. The walk is anchored at the most-specific
     * picked scope and excludes the picked scopes themselves, so it can never
     * answer with a narrower tier than the one being edited — and
     * `excludeConfigId` is what treats the in-progress draft as not yet saved.
     */
    getInheritedValuesForScopes: {
      query: {
        input: {
          projectId: string;
          scopes: Array<{ scopeType: ModelProviderScopeType; scopeId: string }>;
          excludeConfigId?: string;
        };
        output: ModelDefaultInheritedValues;
      };
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
    /**
     * What one feature key's model resolves to, all cascade tiers considered.
     *
     * Declared with its real shape rather than `unknown` because the codex
     * post-connect ask reads `model` off it to decide whether the question is
     * already answered — `unknown` reaches the browser as `{}`, and that read
     * would have been unchecked.
     */
    getResolvedDefault: {
      query: {
        input: ProjectScope & { featureKey: string };
        output: ModelDefaultEffective | null;
      };
    };
  };

  llmModelCost: {
    /** The cost rules the project's settings page renders. */
    getAllForProject: {
      query: { input: ProjectScope; output: ModelCost[] };
    };

    /**
     * Writes one cost rule: a new one when `id` is absent, that one when it is.
     *
     * `scopeType`/`scopeId` name the tenant the rule is anchored to, and the
     * server requires MANAGE on that scope rather than on the project the call
     * was made from — so an admin can push one policy down the cascade
     * (PROJECT overrides TEAM overrides ORGANIZATION) without every project
     * re-entering it. Both default to the calling project.
     *
     * The rates are per TOKEN and the three cache rates are optional: absent
     * means "bill this at the input rate", which is not the same as zero.
     */
    createOrUpdate: {
      mutation: {
        input: ProjectScope & {
          id?: string;
          model: string;
          regex: string;
          inputCostPerToken: number;
          outputCostPerToken: number;
          cacheReadCostPerToken?: number;
          cacheCreationCostPerToken?: number;
          cacheCreation1hCostPerToken?: number;
          scopeType?: ModelProviderScopeType;
          scopeId?: string;
        };
        output: ModelCost;
      };
    };

    /**
     * Which recently-seen spans this rule would match, priced at the rates
     * being typed.
     *
     * Gated on `traces:view` rather than on the cost permission, because the
     * answer carries span metadata and not cost configuration. A reader who may
     * edit costs but not read traces gets the form without the preview.
     */
    previewMatchingSpans: {
      query: { input: CostRulePreviewInput; output: CostRuleMatchingSpansPreview };
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

/**
 * The alias the recovered editor modules moved with: `api.modelProvider.…`,
 * unchanged. Same instance, so it is the same transport and the same cache.
 */
export const api = modelProviderApi;
