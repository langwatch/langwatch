// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  NurturingApi,
  nurturingConfig,
  nurturingSecrets,
  type NurturingServerConfig,
  type NurturingSignal,
} from "@langwatch/enterprise-nurturing-contract";
import type { EventingCommands } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { counter } from "@langwatch/observability/metrics";
import {
  OrganizationApi,
  type OrganizationCreatedEventData,
} from "@langwatch/organization-contract";
import type { FeatureSetup } from "@langwatch/process";
import { nowInstant } from "@langwatch/time";
import { UserApi } from "@langwatch/user-contract";

import type { NurturingChannels } from "../channels/nurturing.channels.ts";
import { buildNurturingPipeline, type NurturingPipeline } from "../eventing/nurturing.pipeline.ts";
import type { NurturingRepositories } from "../repositories/nurturing.repositories.ts";
import { NurturingCodingMilestonesService } from "../services/nurturing-coding-milestones.service.ts";
import { NurturingCopiedProjectsService } from "../services/nurturing-copied-projects.service.ts";
import { NurturingDeliveryService } from "../services/nurturing-delivery.service.ts";
import { NurturingGatewayFactsService } from "../services/nurturing-gateway-facts.service.ts";
import { NurturingGovernanceFactsService } from "../services/nurturing-governance-facts.service.ts";
import { NurturingGuidedOnboardingBackfillService } from "../services/nurturing-guided-onboarding-backfill.service.ts";
import { NurturingMemberFactsService } from "../services/nurturing-member-facts.service.ts";
import { NurturingMilestonesService } from "../services/nurturing-milestones.service.ts";
import { NurturingOrganizationCreatedService } from "../services/nurturing-organization-created.service.ts";
import { NurturingOrganizationUsageService } from "../services/nurturing-organization-usage.service.ts";
import { NurturingUserErasureService } from "../services/nurturing-user-erasure.service.ts";
import { NurturingService } from "../services/nurturing.service.ts";

type NurturingSetup = FeatureSetup<
  typeof NurturingModule.dependencies,
  NurturingServerConfig,
  NurturingRepositories,
  NurturingChannels
>;

/** Nurturing learns from the owners' events; no module names it as a peer, so it can never close a cycle (§9). */
export class NurturingModule implements NurturingApi {
  static readonly contract = NurturingApi;
  static readonly dependencies = {
    users: UserApi,
    organizations: OrganizationApi,
  };
  static readonly config = nurturingConfig;
  static readonly secrets = nurturingSecrets;

  readonly #pipeline: NurturingPipeline;
  readonly #delivery: NurturingDeliveryService;
  readonly #organizationUsage: NurturingOrganizationUsageService | undefined;
  readonly #organizationCreated: NurturingOrganizationCreatedService | undefined;
  #commands: EventingCommands<NurturingPipeline> | undefined;

  private constructor({
    pipeline,
    delivery,
    organizationUsage,
    organizationCreated,
  }: Readonly<{
    pipeline: NurturingPipeline;
    delivery: NurturingDeliveryService;
    organizationUsage: NurturingOrganizationUsageService | undefined;
    organizationCreated: NurturingOrganizationCreatedService | undefined;
  }>) {
    this.#pipeline = pipeline;
    this.#delivery = delivery;
    this.#organizationUsage = organizationUsage;
    this.#organizationCreated = organizationCreated;
  }

  static async create({
    channels,
    dependencies,
    repositories,
    resources,
  }: NurturingSetup): Promise<NurturingModule> {
    const customerIo = channels.customerIo
      ? NurturingService.create({ channel: channels.customerIo, users: dependencies.users })
      : void 0;
    const { posthog } = channels;
    if (posthog) resources.own("Nurturing PostHog client", () => posthog.close());

    const memberFacts = NurturingMemberFactsService.create({
      claims: repositories.claims,
      milestones: repositories.milestones,
      projects: repositories.projects,
      organizations: dependencies.organizations,
    });
    const delivery = NurturingDeliveryService.create({
      claims: repositories.claims,
      customerIo,
      posthog,
      users: dependencies.users,
      memberFacts,
      members: repositories.members,
      erasedUsers: repositories.erasedUsers,
      guidedBackfill:
        customerIo &&
        NurturingGuidedOnboardingBackfillService.create({
          claims: repositories.claims,
          customerIo,
          members: repositories.members,
          organizations: dependencies.organizations,
        }),
    });
    const gatewayFacts = NurturingGatewayFactsService.create({
      keys: repositories.virtualKeys,
      erasedUsers: repositories.erasedUsers,
      members: repositories.members,
      admins: memberFacts,
      logger: createLogger("langwatch:nurturing:gateway-facts"),
    });
    const governanceFacts = NurturingGovernanceFactsService.create({
      erasedUsers: repositories.erasedUsers,
      members: repositories.members,
      admins: memberFacts,
      logger: createLogger("langwatch:nurturing:governance-facts"),
    });
    const milestones = NurturingMilestonesService.create({
      milestones: repositories.milestones,
      projects: repositories.projects,
      claims: repositories.claims,
    });
    const codingMilestones = NurturingCodingMilestonesService.create({
      milestones: repositories.milestones,
      projects: repositories.projects,
      organizations: dependencies.organizations,
      clock: { nowMs: () => nowInstant().epochMilliseconds },
    });
    const copiedProjects = NurturingCopiedProjectsService.create({
      placements: repositories.placements,
      organizationsCreated: repositories.organizationsCreated,
    });
    const logger = createLogger("langwatch:nurturing");
    // Without this line "the sync never ran" and "it ran fine" look the same in prod logs.
    logger.info(
      { customerIoApiKeyPresent: customerIo !== void 0 },
      customerIo ? "nurturing usage sync enabled" : "nurturing usage sync disabled",
    );
    const organizationUsage = customerIo
      ? NurturingOrganizationUsageService.create({
          projectUsage: repositories.projectUsage,
          traceDays: repositories.traceDays,
          evaluationDays: repositories.evaluationDays,
          copiedProjects,
          placements: repositories.placements,
          organizationsCreated: repositories.organizationsCreated,
          milestones: repositories.milestones,
          members: repositories.members,
          erasedUsers: repositories.erasedUsers,
          claims: repositories.claims,
          sendBatch: (calls) => customerIo.batchOrThrow(calls),
          clock: { nowMs: () => nowInstant().epochMilliseconds },
          logger,
          syncs: counter({
            name: "nurturing_org_usage_sync_total",
            description: "Nurturing organization usage sync attempts, by outcome",
          }),
        })
      : void 0;
    const organizationCreated = customerIo
      ? NurturingOrganizationCreatedService.create({
          erasedUsers: repositories.erasedUsers,
          sendBatch: (calls) => customerIo.batchOrThrow(calls),
          logger,
        })
      : void 0;
    const userErasure = NurturingUserErasureService.create({
      personalProjects: repositories.personalProjects,
      organizations: repositories.milestones,
      members: repositories.members,
      virtualKeys: repositories.virtualKeys,
    });
    return new NurturingModule({
      pipeline: buildNurturingPipeline({
        deliver: (input) => delivery.deliver(input),
        organizationMembers: async (organizationId) =>
          (await dependencies.organizations.getAllMembers({ organizationId })).map(({ id }) => id),
        guidedTurnFailed: (data) => delivery.deliverGuidedTurnFailed(data),
        usageReportReceived: (input) => delivery.deliverUsageReport(input),
        evaluationsCompleted: (input) => milestones.evaluationsCompleted(input),
        simulationRunsFinished: (input) => milestones.simulationRunsFinished(input),
        codingSessionsStored: (input) => codingMilestones.sessionsStored(input),
        forgetErasedUser: (input) => userErasure.forgetUser(input),
        virtualKeyCreated: (input) => gatewayFacts.virtualKeyCreated(input),
        keyBudgetCrossed: (input) => gatewayFacts.keyBudgetCrossed(input),
        keyFirstRequested: (input) => gatewayFacts.keyFirstRequested(input),
        unbudgetedSpendRecorded: (input) => gatewayFacts.unbudgetedSpendRecorded(input),
        governanceSourceConnected: (input) => governanceFacts.sourceConnected(input),
        governanceSourceLive: (input) => governanceFacts.sourceWentLive(input),
      }),
      delivery,
      organizationUsage,
      organizationCreated,
    });
  }

  /**
   * Whether the per-email usage syncs at all: only with a Customer.io channel. Without one, the
   * usage pipeline registers only its copies, so no usage or trace row is written that no sync
   * would read or prune.
   */
  syncsOrganizationUsage(): boolean {
    return this.#organizationUsage !== undefined;
  }

  /** A project's usage changed: its organization's traits go to Customer.io. */
  async organizationUsageChanged(input: Readonly<{ projectId: string }>): Promise<void> {
    await this.#organizationUsage?.usageChanged(input);
  }

  /** A project traced: its organization's traits sync, unless its counting window ended. */
  async organizationTracesChanged(input: Readonly<{ projectId: string }>): Promise<void> {
    await this.#organizationUsage?.tracesChanged(input);
  }

  /**
   * A new organization: its name and creation time go to Customer.io on its founder, never its
   * plan.
   */
  async organizationCreated(data: OrganizationCreatedEventData): Promise<void> {
    await this.#organizationCreated?.organizationCreated(data);
  }

  /**
   * A plan fact that won nurturing's plan copy, on its live delivery: Customer.io is told the plan.
   * Rejects when refused, or for a catch-up with no channel, so the plan fold's job retries.
   */
  async deliverPlan(input: Readonly<{ key: string; signal: NurturingSignal }>): Promise<void> {
    await this.#delivery.deliver(input);
  }

  /** Drops every project's trace days before `beforeDay`: no read reaches them. */
  async pruneTraceDaysBefore(input: Readonly<{ beforeDay: string }>): Promise<void> {
    await this.#organizationUsage?.pruneTraceDaysBefore(input);
  }

  /** The trace windows that ended in (`after`, `upTo`]: their trace traits go once as null. */
  async organizationTraceWindowsEnded(
    input: Readonly<{ after: number; upTo: number }>,
  ): Promise<void> {
    await this.#organizationUsage?.traceWindowsEnded(input);
  }

  async recordSignal(signal: NurturingSignal): Promise<void> {
    if (!this.#commands) throw new Error("nurturing pipeline senders are not connected yet");
    await this.#commands.recordSignal.send({
      tenantId: signal.tenantId,
      occurredAt: signal.occurredAt,
      signal,
    });
  }

  /** The nurturing pipeline this module registers, built once by {@link create}. */
  pipeline(): NurturingPipeline {
    return this.#pipeline;
  }

  /** Binds the built pipeline's own senders. */
  connectCommands(commands: EventingCommands<NurturingPipeline>): void {
    this.#commands = commands;
  }
}
