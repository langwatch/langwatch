/**
 * What a mounted model-provider declaration runs on in a test: the runtime's
 * process ports, and a real app over a gateway stub and a probe stub.
 */
import type { AuthzApi, AuthzPermission } from "@langwatch/authz-contract";
import type { TrpcRuntimePorts } from "@langwatch/api/trpc";
import type {
  ModelProviderCredentialVerdict,
  ModelProviderService,
} from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import { ModelProviderApp } from "../../app/model-provider.app.ts";
import {
  CodexAccountService,
  type CodexDeviceCode,
  type CodexPollResult,
} from "../../adapters/codex-oauth.model-provider-token-refresher.adapter.ts";
import { ModelProviderCredentialProbePort } from "../../ports/model-provider.port.ts";
import { ModelProviderAuthorizationService } from "../../services/model-provider-authorization.service.ts";
import { ModelProviderWriteAuthorizationService } from "../../services/model-provider-write-authorization.service.ts";

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
export class RecordingCredentialProbe extends ModelProviderCredentialProbePort {
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
 * The application under test: the gateway is a stub of exactly the operations
 * a suite reads, and the write check runs against the authorization answer the
 * suite decides.
 */
export function createModelProviderTestApp(options: {
  modelProviders?: Partial<ModelProviderService>;
  spans?: unknown;
  probe?: RecordingCredentialProbe;
  permits?: ModelProviderTestDecision;
  /** The device flow this suite decided, or none where it reaches no issuer. */
  codexAccounts?: CodexAccountService;
}): { app: ModelProviderApp; probe: RecordingCredentialProbe } {
  const probe = options.probe ?? RecordingCredentialProbe.create(VERIFIED);
  const permits = options.permits ?? (() => true);
  const authorization = ModelProviderAuthorizationService.create(
    createApiFixture<AuthzApi>({
      getDecision: async ({ permission }: { permission: AuthzPermission }) => ({
        permitted: permits(permission),
        organizationRole: null,
      }),
    }),
  );

  const app = ModelProviderApp.create({
    modelProviders: options.modelProviders as ModelProviderService,
    spans: options.spans ?? {},
    credentialProbe: probe,
    providerAuthorization: ModelProviderWriteAuthorizationService.create(authorization),
    codexAccounts: options.codexAccounts ?? new CodexAccountService(refuseFetch),
  });

  return { app, probe };
}
