import {
  ProjectInvalidCredentialsError,
  ProjectMissingCredentialsError,
  type RateLimiter,
} from "@langwatch/api";
import { AggregateProjectHasNoCredentialError, type ApiKeyApi } from "@langwatch/api-key-contract";
import { AuthValidateRateLimitedError } from "@langwatch/auth-contract";
import { resolveRequestBound } from "@langwatch/plans";
import { isAggregateProjectKind } from "@langwatch/project-contract";

import { callerKeyOf } from "../rules/auth-caller-key.rules.ts";

/** What the legacy token check reads through: the credential ledger and a per-caller counter. */
interface ProjectAuthTokenDeps {
  apiKeys: Pick<ApiKeyApi, "findResolvedToken">;
  rateLimiter: RateLimiter;
}

/** The legacy `X-Auth-Token` check, answering the project the token names. */
export class ProjectAuthTokenService {
  static create(deps: ProjectAuthTokenDeps): ProjectAuthTokenService {
    return new ProjectAuthTokenService(deps);
  }

  private constructor(private readonly deps: ProjectAuthTokenDeps) {}

  /**
   * Every call probes a secret and gets a yes/no answer, so the caller is counted first:
   * past the registry's per-minute ceiling the probe stops answering.
   */
  async validateProjectAuthToken(input: {
    token: string | undefined;
    forwardedFor: string | undefined;
  }): Promise<{ projectSlug: string }> {
    if (!input.token) throw new ProjectMissingCredentialsError();

    await this.countCall(callerKeyOf(input.forwardedFor));
    const resolved = await this.deps.apiKeys.findResolvedToken({ token: input.token });
    if (!resolved) throw new ProjectInvalidCredentialsError();
    // ADR-177 decision 7: an SDK is never told an aggregate's stored key is good to send with.
    if (isAggregateProjectKind(resolved.project.kind)) {
      throw new AggregateProjectHasNoCredentialError({ meta: { projectId: resolved.project.id } });
    }

    return { projectSlug: resolved.project.slug };
  }

  private async countCall(callerKey: string): Promise<void> {
    const requests = resolveRequestBound("authValidatePerIpPerMinute", "ENTERPRISE");
    const decision = await this.deps.rateLimiter.check(`auth-validate:${callerKey}`, {
      requests,
      seconds: 60,
    });

    if (!decision.allowed) {
      throw new AuthValidateRateLimitedError({ retryAfterSeconds: decision.retryAfterSeconds });
    }
  }
}
