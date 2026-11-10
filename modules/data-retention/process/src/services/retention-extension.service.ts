/**
 * Retention carried to the rows already stored. An activation or a lengthening save records an
 * extension (raise only); an admin's apply records a request (exact rewrite). Either fans out one
 * command per project under the scope and category. Spec: retention-apply-to-stored-data.feature
 */
import type { RetentionCategory, ScopeAssignment } from "@langwatch/data-retention-contract";

import type {
  ApplyRetentionExtensionCommandData,
  RecordRetentionExtensionCommandData,
  RequestStoredRetentionApplyCommandData,
  StoredRetentionMode,
} from "../eventing/retention-extension.events.ts";
import type { DataRetentionService } from "./data-retention.service.ts";
import type { SeatRetentionPolicyService } from "./seat-retention-policy.service.ts";

type Senders = Readonly<{
  record: (data: RecordRetentionExtensionCommandData) => Promise<unknown>;
  request: (data: RequestStoredRetentionApplyCommandData) => Promise<unknown>;
  apply: (data: ApplyRetentionExtensionCommandData) => Promise<unknown>;
}>;

type Options = Readonly<{
  seatPolicies: Pick<SeatRetentionPolicyService, "provisionMissing">;
  projects: Pick<DataRetentionService, "findScopeProjectIds">;
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

  /** Records a lengthening save at one scope; its projects' stored rows are then raised. */
  async extendFromSave({
    organizationId,
    scope,
    category,
    retentionDays,
    extensionId,
    at,
  }: {
    organizationId: string;
    scope: ScopeAssignment;
    category: RetentionCategory;
    retentionDays: number;
    extensionId: string;
    at: number;
  }): Promise<void> {
    await this.senders().record({
      tenantId: organizationId,
      organizationId,
      extensionId,
      scope,
      retention: [{ category, retentionDays }],
      extendedAt: at,
    });
  }

  /** Records an admin's ask to rewrite the scope's stored rows to the periods they resolve to. */
  async requestApply({
    organizationId,
    scope,
    categories,
    requestId,
    at,
  }: {
    organizationId: string;
    scope: ScopeAssignment;
    categories: readonly RetentionCategory[];
    requestId: string;
    at: number;
  }): Promise<void> {
    await this.senders().request({
      tenantId: organizationId,
      organizationId,
      requestId,
      scope,
      categories: [...categories],
      requestedAt: at,
    });
  }

  /** One command per project and category; a failed send throws, so the outbox retries. */
  async applyToProjects({
    organizationId,
    extensionId,
    scope,
    mode,
    categories,
    at,
  }: {
    organizationId: string;
    extensionId: string;
    scope?: ScopeAssignment;
    mode?: StoredRetentionMode;
    categories: readonly RetentionCategory[];
    at: number;
  }): Promise<void> {
    const projectIds = await this.options.projects.findScopeProjectIds({
      organizationId,
      scope: scope ?? { scopeType: "ORGANIZATION", scopeId: organizationId },
    });
    for (const projectId of projectIds) {
      for (const category of categories) {
        await this.senders().apply({
          tenantId: projectId,
          organizationId,
          projectId,
          extensionId,
          category,
          mode: mode ?? "raise",
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
