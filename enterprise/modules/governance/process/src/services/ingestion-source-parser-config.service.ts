import {
  GovernanceValidationError,
  type GovernanceIngestionSource,
} from "@langwatch/enterprise-governance-contract";

import type { ProviderAccountChannel } from "../channels/provider-account.channel.ts";
import type {
  IngestionSourceClaim,
  IngestionSourceRepository,
} from "../repositories/ingestion-source.repository.ts";
import {
  findAzureBillHistoryComplaints,
  findAzureBillRepointComplaints,
  withAzureBillIdentity,
} from "../rules/azure-bill-identity.rules.ts";
import {
  extractClaimedSubscription,
  findAzureBillClaimComplaints,
  findAzureBillCredentialComplaints,
} from "../rules/azure-bill-ownership.rules.ts";
import {
  extractClaimedEnvironment,
  findEnvironmentClaimComplaints,
} from "../rules/environment-ownership.rules.ts";
import { credentialsAsSent, isSealedCredentials } from "../rules/ingestion-credentials.rules.ts";
import {
  findProviderAccountClaimComplaints,
  hasAdminCredentials,
  PROVIDER_ACCOUNT_UNCONFIRMED,
  readsProviderAccount,
} from "../rules/provider-account-ownership.rules.ts";

/**
 * The parser config a create or update stores: the one-reader-per-claim guards, the Azure bill
 * identity settled, and the fields a reader never received carried over from the stored config.
 */
export class IngestionSourceParserConfigService {
  private constructor(
    private readonly repository: IngestionSourceRepository,
    private readonly providerAccounts: ProviderAccountChannel,
  ) {}

  static create({
    repository,
    providerAccounts,
  }: {
    repository: IngestionSourceRepository;
    providerAccounts: ProviderAccountChannel;
  }): IngestionSourceParserConfigService {
    return new IngestionSourceParserConfigService(repository, providerAccounts);
  }

  /** A stored Azure bill source may not be pointed at another bill once it has pulled. */
  assertRepointAllowed({
    existing,
    incoming,
  }: {
    existing: GovernanceIngestionSource;
    incoming: GovernanceIngestionSource["parserConfig"];
  }): void {
    refuseOnComplaint(
      findAzureBillRepointComplaints({
        storedConfig: existing.parserConfig,
        pollerCursor: existing.pollerCursor,
        incoming,
      }),
    );
  }

  /**
   * The one-reader-per-claim guards, in main's order: the Azure bill (its own credential, then
   * another reader), the environment, then the provider account, whose id is returned to be stored.
   * Each reads the organisation's sources only when the config makes that claim.
   */
  async assertClaimsAreFree({
    organizationId,
    sourceType,
    parserConfig,
    existing,
    resentCredentials = false,
  }: {
    organizationId: string;
    sourceType: string;
    parserConfig: Record<string, unknown>;
    existing?: GovernanceIngestionSource;
    /** Whether this edit sent credentials of its own rather than carrying the stored ones. */
    resentCredentials?: boolean;
  }): Promise<{ providerAccountId?: string }> {
    const sourceId = existing?.id;
    let claims: Promise<IngestionSourceClaim[]> | undefined;
    const claimsOf = () => (claims ??= this.repository.findClaims(organizationId));

    if (extractClaimedSubscription(parserConfig) !== null) {
      refuseOnComplaint(
        findAzureBillCredentialComplaints({
          parserConfig: credentialsAsSent({ parserConfig, existing, resentCredentials }),
          storedParserConfig: existing?.parserConfig,
        }),
      );
      refuseOnComplaint(
        findAzureBillClaimComplaints({
          parserConfig,
          claimedBy: (await claimsOf()).flatMap((claim) => {
            const subscriptionId = extractClaimedSubscription(claim.parserConfig);
            return subscriptionId ? [{ id: claim.id, name: claim.name, subscriptionId }] : [];
          }),
          sourceId,
        }),
      );
    }

    if (extractClaimedEnvironment(parserConfig) !== null) {
      refuseOnComplaint(
        findEnvironmentClaimComplaints({
          parserConfig,
          claimedBy: (await claimsOf()).flatMap((claim) => {
            const environmentUrl = extractClaimedEnvironment(claim.parserConfig);
            return environmentUrl ? [{ id: claim.id, name: claim.name, environmentUrl }] : [];
          }),
          sourceId,
        }),
      );
    }

    if (!readsProviderAccount({ sourceType }) || !hasAdminCredentials(parserConfig)) {
      return {};
    }
    const providerAccountId = await this.providerAccounts
      .getAccountId({ sourceType, parserConfig })
      .catch(() => refuse(PROVIDER_ACCOUNT_UNCONFIRMED));
    refuseOnComplaint(
      findProviderAccountClaimComplaints({
        providerAccountId,
        parserConfig,
        claimedBy: (await claimsOf()).flatMap((claim) =>
          claim.providerAccountId
            ? [
                {
                  id: claim.id,
                  name: claim.name,
                  providerAccountId: claim.providerAccountId,
                  report:
                    typeof claim.parserConfig.report === "string"
                      ? claim.parserConfig.report
                      : null,
                  disabled: claim.status === "disabled",
                },
              ]
            : [],
        ),
        sourceId,
      }),
    );

    return { providerAccountId };
  }

  /** The config to store, its server-owned Azure billing identity settled; the store seals it. */
  async prepareParserConfig({
    organizationId,
    parserConfig,
    existing,
  }: {
    organizationId: string;
    parserConfig: Record<string, unknown>;
    existing?: GovernanceIngestionSource;
  }): Promise<Record<string, unknown>> {
    const history =
      extractClaimedSubscription(parserConfig) === null
        ? []
        : await this.repository.findAzureBillHistory(organizationId);

    const identity = {
      parserConfig,
      sourceId: existing?.id,
      storedConfig: existing?.parserConfig,
      history,
    };
    refuseOnComplaint(findAzureBillHistoryComplaints(identity));

    return withAzureBillIdentity(identity);
  }

  /**
   * The parser config a save means, with the fields a reader never received faithfully carried
   * over from the stored one. A credential in its stored form is refused rather than saved back,
   * since re-saving a redacted secret would replace the real one with its own marker.
   */
  mergedParserConfig({
    existing,
    incoming,
  }: {
    existing: GovernanceIngestionSource;
    incoming: GovernanceIngestionSource["parserConfig"];
  }): GovernanceIngestionSource["parserConfig"] {
    const merged = { ...incoming };
    if (isSealedCredentials(merged.credentials)) {
      const message =
        "Credentials cannot be submitted in their stored form. Re-enter the secret to change " +
        "this source, or omit it to keep the current one.";

      throw new GovernanceValidationError(message, { formErrors: [message] });
    }

    for (const key of Object.keys(existing.parserConfig)) {
      const carried =
        key === "credentials" || key === "adapter" || key === "schedule" || key.startsWith("_");
      if (carried && merged[key] === undefined) {
        merged[key] = existing.parserConfig[key];
      }
    }

    return merged;
  }
}

/** A guard's complaint, refused the way the rest of this service refuses a save. */
function refuse(complaint: string): never {
  throw new GovernanceValidationError(complaint, { formErrors: [complaint] });
}

function refuseOnComplaint(complaints: readonly string[]): void {
  const [complaint] = complaints;
  if (complaint !== undefined) {
    refuse(complaint);
  }
}
