import { normalizeIdentifierValue } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";

import type { OrganizationMfaRequirementMailChannel } from "../channels/organization-mfa-requirement-mail.channel.ts";
import type { TwoStepVerificationRepository } from "../repositories/two-step-verification.repository.ts";
import type { IdentityEmailService } from "./identity-email.service.ts";

const logger = createLogger("langwatch:identity:organization-mfa");

export type OrganizationMfaNotifierServiceDeps = {
  accounts: TwoStepVerificationRepository;
  mail: OrganizationMfaRequirementMailChannel;
  emails: Pick<IdentityEmailService, "resolveEmail">;
};

type Notified = { userId: string; email: string | null };

/**
 * Tells an organization's active members its requirement changed (main's
 * EmailOrganizationMfaNotifier): every recipient is attempted before a failure is
 * reported, and the log names the failed count rather than claiming the whole audience.
 */
export class OrganizationMfaNotifierService {
  static create(deps: OrganizationMfaNotifierServiceDeps): OrganizationMfaNotifierService {
    return new OrganizationMfaNotifierService(deps);
  }

  private constructor(private readonly deps: OrganizationMfaNotifierServiceDeps) {}

  async notifyRequirementChanged({
    organizationId,
    organizationName,
    actorUserId,
    required,
    members,
  }: {
    organizationId: string;
    organizationName: string;
    actorUserId: string;
    required: boolean;
    members: readonly Notified[];
  }): Promise<void> {
    const [actor] = await this.deps.accounts.findPeople({ userIds: [actorUserId] });
    const actorName = actor?.name ?? actor?.email ?? "An administrator";
    const { destinations, failures } = await this.resolveDestinations(members);
    const deliveries = await Promise.allSettled(
      [...destinations.values()].map((to) =>
        this.deps.mail.sendRequirementChanged({ to, organizationName, actorName, required }),
      ),
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
  ): Promise<{ destinations: Map<string, string>; failures: unknown[] }> {
    const destinations = new Map<string, string>();
    const failures: unknown[] = [];
    const resolutions = await Promise.allSettled(
      members.map(async ({ userId, email }) => {
        const resolution = await this.deps.emails.resolveEmail({ userId });
        return { userId, email: resolution.kind === "resolved" ? resolution.email : email };
      }),
    );
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
      if (!destinations.has(normalized)) destinations.set(normalized, email);
    }
    return { destinations, failures };
  }
}
