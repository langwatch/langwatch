/**
 * What a mounted model-provider declaration runs on in a test: the runtime's
 * process ports, and a real app over a gateway stub and a probe stub.
 */
import type { AuthzApi, AuthzPermission } from "@langwatch/authz-contract";
import type { TrpcRuntimePorts } from "@langwatch/api/trpc";
import type {
  ModelProviderApi,
  ModelProviderCredentialVerdict,
} from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import { createModelProviderTestApp } from "../../app/__tests__/model-provider.fixture.ts";
import type { ModelProviderRepositories } from "../../repositories/model-provider.repositories.ts";
import { MemoryModelProviderRepositories } from "../../repositories/memory/memory.model-provider.repositories.ts";
import type { ModelProviderApp } from "../../app/model-provider.app.ts";
import {
  CodexAccountService,
  type CodexDeviceCode,
  type CodexPollResult,
} from "../../services/codex-oauth.model-provider-token-refresher.service.ts";
import { ModelProviderCredentialProbe } from "../../app/model-provider.members.ts";

/** What a mount reads off the request: who is calling. */
export type ModelProviderTrpcTestContext = { actor: { id: string } };

/** Whether the caller holds one permission on the scope the input named. */
export type ModelProviderTestDecision = (permission: AuthzPermission) => boolean;

export function modelProviderTrpcTestPorts(
  permits: ModelProviderTestDecision = () => true,
): TrpcRuntimePorts<ModelProviderTrpcTestContext> {
  return {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
    authorization: {
      forRequest: () => ({
        getDecision: async ({ permission }) => ({
          permitted: permits(permission),
          organizationRole: null,
        }),
        getProjectAnyDecision: async ({ permissions }) => ({
          permitted: permissions.some((permission) => permits(permission)),
          organizationRole: null,
        }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };
}

/** Every probe this test decided, and the verdict each one answers with. */
export class RecordingCredentialProbe extends ModelProviderCredentialProbe {
  readonly probed: Array<{ provider: string; customKeys: Record<string, string> }> = [];
  readonly probedStored: Array<{ projectId: string; provider: string }> = [];

  static create(verdict: ModelProviderCredentialVerdict): RecordingCredentialProbe {
    return new RecordingCredentialProbe(verdict);
  }

  private constructor(private readonly verdict: ModelProviderCredentialVerdict) {
    super();
  }

  probe(input: {
    provider: string;
    customKeys: Record<string, string>;
  }): Promise<ModelProviderCredentialVerdict> {
    this.probed.push(input);

    return Promise.resolve(this.verdict);
  }

  probeStored(input: {
    projectId: string;
    provider: string;
  }): Promise<ModelProviderCredentialVerdict> {
    this.probedStored.push({ projectId: input.projectId, provider: input.provider });

    return Promise.resolve(this.verdict);
  }
}

const VERIFIED: ModelProviderCredentialVerdict = { outcome: "verified", valid: true };

/** A suite that did not decide the issuer's answers must not reach one. */
const refuseFetch: typeof fetch = () => {
  throw new Error("this suite reached the Codex issuer without deciding its answers");
};

/** The device flow as a suite decides it, with no issuer reached. */
export class StubCodexAccounts extends CodexAccountService {
  static create(poll: CodexPollResult): StubCodexAccounts {
    return new StubCodexAccounts(poll);
  }

  private constructor(private readonly poll: CodexPollResult) {
    super(refuseFetch);
  }

  override startDeviceSignIn(): Promise<CodexDeviceCode> {
    return Promise.resolve({
      userCode: "ABCD-EFGH",
      deviceAuthId: "device-auth-1",
      verificationUrl: "https://auth.openai.com/codex/device",
      intervalSeconds: 5,
    });
  }

  override pollDeviceSignIn(): Promise<CodexPollResult> {
    return Promise.resolve(this.poll);
  }
}

/**
 * The application under test: a real app over the memory repositories, with
 * the operations a suite decided answering in place of the stored ones. The
 * checks the app runs before a probe leaves - the per-scope write standing  - 
 * are the real ones, because that gate is the whole authorization.
 */
export function mountableModelProviderApp(options: {
  modelProviders?: Partial<ModelProviderApi>;
  spans?: unknown;
  probe?: RecordingCredentialProbe;
  permits?: ModelProviderTestDecision;
  /** The device flow this suite decided, or none where it reaches no issuer. */
  codexAccounts?: CodexAccountService;
}): {
  app: ModelProviderApi;
  probe: RecordingCredentialProbe;
  repositories: ModelProviderRepositories;
} {
  const probe = options.probe ?? RecordingCredentialProbe.create(VERIFIED);
  const permits = options.permits ?? (() => true);
  const repositories = MemoryModelProviderRepositories.create();

  const real = createModelProviderTestApp({
    repositories,
    dependencies: {
      permissions: createApiFixture<AuthzApi>({
        getDecision: async ({ permission }: { permission: AuthzPermission }) => ({
          permitted: permits(permission),
          organizationRole: null,
        }),
      }),
    },
    members: {
      credentialProbe: probe,
      spans: options.spans ?? {},
      ...(options.codexAccounts ? { codexAccounts: options.codexAccounts } : {}),
    },
  });

  return { app: { ...forwarded(real), ...options.modelProviders }, probe, repositories };
}

/** Every operation of the real app, bound to it so its private state travels. */
function forwarded(app: ModelProviderApp): ModelProviderApi {
  return {
    estimateCost: (...args) => app.estimateCost(...args),
    listForProject: (...args) => app.listForProject(...args),
    listForOrganization: (...args) => app.listForOrganization(...args),
    getForProject: (...args) => app.getForProject(...args),
    findProviderForProject: (...args) => app.findProviderForProject(...args),
    findRowServingModel: (...args) => app.findRowServingModel(...args),
    getExecutionProviders: (...args) => app.getExecutionProviders(...args),
    prepareExecution: (...args) => app.prepareExecution(...args),
    upsert: (...args) => app.upsert(...args),
    upsertUnattributed: (...args) => app.upsertUnattributed(...args),
    delete: (...args) => app.delete(...args),
    validateApiKey: (...args) => app.validateApiKey(...args),
    validateStoredKey: (...args) => app.validateStoredKey(...args),
    startCodexDeviceSignIn: () => app.startCodexDeviceSignIn(),
    pollCodexDeviceSignIn: (...args) => app.pollCodexDeviceSignIn(...args),
    testConnection: (...args) => app.testConnection(...args),
    getCodexStatus: (...args) => app.getCodexStatus(...args),
    refreshCodexForGateway: (...args) => app.refreshCodexForGateway(...args),
    isManagedProvider: (...args) => app.isManagedProvider(...args),
    getDefaultSnapshot: (...args) => app.getDefaultSnapshot(...args),
    getDefaultSnapshotUnattributed: (...args) => app.getDefaultSnapshotUnattributed(...args),
    getInheritedValues: (...args) => app.getInheritedValues(...args),
    findResolvedDefault: (...args) => app.findResolvedDefault(...args),
    resolveModelForFeature: (...args) => app.resolveModelForFeature(...args),
    findAlternateModel: (...args) => app.findAlternateModel(...args),
    setDefault: (...args) => app.setDefault(...args),
    saveDefaultConfig: (...args) => app.saveDefaultConfig(...args),
    assertApiKeyMayWriteDefaultScopes: (...args) => app.assertApiKeyMayWriteDefaultScopes(...args),
    findDefaultConfig: (...args) => app.findDefaultConfig(...args),
    deleteDefaultConfig: (...args) => app.deleteDefaultConfig(...args),
    listCosts: (...args) => app.listCosts(...args),
    findModelLimits: (...args) => app.findModelLimits(...args),
    previewCostRuleMatchingSpans: (...args) => app.previewCostRuleMatchingSpans(...args),
    upsertCost: (...args) => app.upsertCost(...args),
    deleteCost: (...args) => app.deleteCost(...args),
    translate: (...args) => app.translate(...args),
    applyCodexCodingDefaults: (...args) => app.applyCodexCodingDefaults(...args),
  };
}
