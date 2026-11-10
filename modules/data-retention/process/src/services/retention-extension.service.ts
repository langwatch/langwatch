/**
 * Retention lengthened at a paid activation, carried to the rows already stored: the activation
 * provisions the organization policies and records the extension; the extension then asks for one
 * raise per project and category. Spec: specs/billing/seat-subscription-retention-policy.feature
 */
import type { RetentionCategory } from "@langwatch/data-retention-contract";

import type {
  ApplyRetentionExtensionCommandData,
  RecordRetentionExtensionCommandData,
} from "../eventing/retention-extension.events.ts";
import type { DataRetentionService } from "./data-retention.service.ts";
import type { SeatRetentionPolicyService } from "./seat-retention-policy.service.ts";

type Senders = Readonly<{
  record: (data: RecordRetentionExtensionCommandData) => Promise<unknown>;
  apply: (data: ApplyRetentionExtensionCommandData) => Promise<unknown>;
}>;

type Options = Readonly<{
  seatPolicies: Pick<SeatRetentionPolicyService, "provisionMissing">;
  projects: Pick<DataRetentionService, "findOrganizationProjectIds">;
}>;

export class RetentionExtensionService {
  #senders: Senders | undefined;

  static create(options: Options): RetentionExtensionService {
    return new RetentionExtensionService(options);
  }

  private constructor(private readonly options: Options) {}

  /** The extension pipeline's senders, bound once the process registered it. */
  connect(senders: Senders): void {
    this.#senders = senders;
  }

  /**
   * Provisions the organization policies, then records the extension under the activation's
   * identity. Safe to repeat: provisioning never writes twice and the record is keyed.
   */
  async extendFromActivation({
    organizationId,
    retentionDays,
    extensionId,
    at,
  }: {
    organizationId: string;
    retentionDays?: number;
    extensionId: string;
    at: number;
  }): Promise<void> {
    const retention = await this.options.seatPolicies.provisionMissing({
      organizationId,
      ...(retentionDays === undefined ? {} : { retentionDays }),
    });
    await this.senders().record({
      tenantId: organizationId,
      organizationId,
      extensionId,
      retention: [...retention],
      extendedAt: at,
    });
  }

  /** One raise command per project and category; a failed send throws, so the outbox retries. */
  async applyToProjects({
    organizationId,
    extensionId,
    categories,
    at,
  }: {
    organizationId: string;
    extensionId: string;
    categories: readonly RetentionCategory[];
    at: number;
  }): Promise<void> {
    const projectIds = await this.options.projects.findOrganizationProjectIds({ organizationId });
    for (const projectId of projectIds) {
      for (const category of categories) {
        await this.senders().apply({
          tenantId: projectId,
          organizationId,
          projectId,
          extensionId,
          category,
          occurredAt: at,
        });
      }
    }
  }

  private senders(): Senders {
    if (!this.#senders) throw new Error("Retention extension used before its pipeline");
    return this.#senders;
  }
}
