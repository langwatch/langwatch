import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type { OtlpIngestCredential } from "@langwatch/trace-server/api-rest/otlp-ingest";

/** Compatibility composition until Governance adopts its complete callable ModuleApi. */
export class ApiOtlpCredentialPolicyAdapter {
  readonly #governance: GovernanceService | undefined;

  private constructor(governance: GovernanceService | undefined) {
    this.#governance = governance;
  }

  static create(governance: GovernanceService | undefined): ApiOtlpCredentialPolicyAdapter {
    return new ApiOtlpCredentialPolicyAdapter(governance);
  }

  async enrich(credential: OtlpIngestCredential): Promise<OtlpIngestCredential> {
    if (!credential.ok) return credential;

    const { identity } = credential;
    const sourceType = identity.ingestSourceType;
    if (!sourceType || identity.apiKeyId === null) return credential;
    if (!this.#governance) return credential;

    try {
      const policies = await this.#governance.resolveOtlpReceiverPolicies({
        organizationId: identity.organizationId,
        sourceType,
        templateId: identity.ingestionTemplateId,
      });
      return {
        ...credential,
        identity: { ...identity, sourcePolicy: { status: "ready", policies } },
      };
    } catch (error) {
      // Raise after parsing so malformed-body and usage-limit responses keep precedence.
      return {
        ...credential,
        identity: { ...identity, sourcePolicy: { status: "failed", error } },
      };
    }
  }
}
