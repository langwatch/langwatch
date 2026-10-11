import { normalizeIdentifierValue } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";

import type { OrganizationMfaRequirementMailChannel } from "../../../channels/organization-mfa-requirement-mail.channel.ts";
import type { IdentityEmailService } from "../../../services/identity-email.service.ts";
import type { TwoStepRequirementNotices } from "../eventing/two-step-requirement-notice.process.ts";
import type { TwoStepVerificationRepository } from "../repositories/two-step-verification.repository.ts";

const logger = createLogger("langwatch:identity:organization-mfa");

type OrganizationMfaNotifierServiceDeps = {
  accounts: TwoStepVerificationRepository;
  mail: OrganizationMfaRequirementMailChannel;
  emails: Pick<IdentityEmailService, "resolveEmail">;
};

type Notified = { userId: string; email: string | null };

/** Sends in bounded batches, so a large organization never opens thousands of sends at once. */
const NOTICE_BATCH_SIZE = 25;

/**
 * Tells an organization's active members its requirement changed (main's
 * EmailOrganizationMfaNotifier), on the worker. Every recipient is attempted before a failure
 * is reported; each mail carries `<notificationKey>:<userId>`, so a retry is not a second mail.
 */
export class OrganizationMfaNotifierService implements TwoStepRequirementNotices {
  static create(deps: OrganizationMfaNotifierServiceDeps): OrganizationMfaNotifierService {
    return new OrganizationMfaNotifierService(deps);
  }

  private constructor(private readonly deps: OrganizationMfaNotifierServiceDeps) {}

  async notifyRequirementChanged({
    notificationKey,
    organizationId,
    actorUserId,
    required,
  }: {
    notificationKey: string;
    organizationId: string;
    actorUserId: string;
    required: boolean;
  }): Promise<void> {
    const [organization, members, [actor]] = await Promise.all([
      this.deps.accounts.getOrganizationSetting({ organizationId }),
      this.deps.accounts.findMemberAccountFactors({ organizationId }),
      this.deps.accounts.findPeople({ userIds: [actorUserId] }),
    ]);
    const actorName = actor?.name ?? actor?.email ?? "An administrator";
    const { destinations, failures } = await this.resolveDestinations(members);
    const deliveries = await settleInBatches([...destinations.values()], ({ userId, email }) =>
      this.deps.mail.sendRequirementChanged({
        to: email,
        organizationName: organization.name,
        actorName,
        required,
        idempotencyKey: `${notificationKey}:${userId}`,
      }),
    );
    failures.push(
      ...deliveries.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
    );
    if (failures.length === 0) return;
    logger.error(
      {
        organizationId,
        actorUserId,
        required,
        attempted: destinations.size,
        failed: failures.length,
      },
      "organization MFA requirement notification delivery failed",
    );
    throw new AggregateError(
      failures,
      `failed to notify ${failures.length} organization member(s) about the MFA requirement change`,
    );
  }

  /** Identity owns the address once a person is latched; one mail per normalized address. */
  private async resolveDestinations(
    members: readonly Notified[],
  ): Promise<{ destinations: Map<string, Notified & { email: string }>; failures: unknown[] }> {
    const destinations = new Map<string, Notified & { email: string }>();
    const failures: unknown[] = [];
    const resolutions = await settleInBatches(members, async ({ userId, email }) => {
      const resolution = await this.deps.emails.resolveEmail({ userId });
      return { userId, email: resolution.kind === "resolved" ? resolution.email : email };
    });
    for (const resolution of resolutions) {
      if (resolution.status === "rejected") {
        failures.push(resolution.reason);
        continue;
      }
      const { userId, email } = resolution.value;
      if (!email) {
        failures.push(
          new Error(`member ${userId} has no email address for the MFA requirement notification`),
        );
        continue;
      }
      const normalized = normalizeIdentifierValue(email);
      if (!destinations.has(normalized)) destinations.set(normalized, { userId, email });
    }
    return { destinations, failures };
  }
}

async function settleInBatches<T, R>(
  items: readonly T[],
  run: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const settled: PromiseSettledResult<R>[] = [];
  for (let start = 0; start < items.length; start += NOTICE_BATCH_SIZE) {
    settled.push(
      ...(await Promise.allSettled(items.slice(start, start + NOTICE_BATCH_SIZE).map(run))),
    );
  }
  return settled;
}
