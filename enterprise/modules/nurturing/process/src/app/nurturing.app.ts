// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  NurturingApi,
  nurturingConfig,
  nurturingSecrets,
  type NurturingServerConfig,
  type NurturingSignal,
} from "@langwatch/enterprise-nurturing-contract";
import type { EventingCommands } from "@langwatch/eventing";
import { OrganizationApi } from "@langwatch/organization-contract";
import type { FeatureSetup } from "@langwatch/process";
import { nowInstant } from "@langwatch/time";
import { UserApi } from "@langwatch/user-contract";

import type { NurturingChannels } from "../channels/nurturing.channels.ts";
import { buildNurturingPipeline, type NurturingPipeline } from "../eventing/nurturing.pipeline.ts";
import type { NurturingRepositories } from "../repositories/nurturing.repositories.ts";
import { NurturingCodingMilestonesService } from "../services/nurturing-coding-milestones.service.ts";
import { NurturingDeliveryService } from "../services/nurturing-delivery.service.ts";
import { NurturingMemberFactsService } from "../services/nurturing-member-facts.service.ts";
import { NurturingMilestonesService } from "../services/nurturing-milestones.service.ts";
import { NurturingOrganizationUsageService } from "../services/nurturing-organization-usage.service.ts";
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
  static readonly dependencies = { users: UserApi, organizations: OrganizationApi };
  static readonly config = nurturingConfig;
  static readonly secrets = nurturingSecrets;

  readonly #pipeline: NurturingPipeline;
  readonly #organizationUsage: NurturingOrganizationUsageService | undefined;
  #commands: EventingCommands<NurturingPipeline> | undefined;

  private constructor(
    pipeline: NurturingPipeline,
    organizationUsage: NurturingOrganizationUsageService | undefined,
  ) {
    this.#pipeline = pipeline;
    this.#organizationUsage = organizationUsage;
  }

  static async create({
    channels,
    dependencies,
    repositories,
    resources,
  }: NurturingSetup): Promise<NurturingModule> {
    const customerIo = channels.customerIo
      ? NurturingService.create({ channel: channels.customerIo })
      : void 0;
    const { posthog } = channels;
    if (posthog) resources.own("Nurturing PostHog client", () => posthog.close());

    const delivery = NurturingDeliveryService.create({
      claims: repositories.claims,
      customerIo,
      posthog,
      users: dependencies.users,
      memberFacts: NurturingMemberFactsService.create({
        claims: repositories.claims,
        milestones: repositories.milestones,
        projects: repositories.projects,
        organizations: dependencies.organizations,
      }),
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
    const organizationUsage = customerIo
      ? NurturingOrganizationUsageService.create({
          projectUsage: repositories.projectUsage,
          traceDays: repositories.traceDays,
          placements: repositories.placements,
          organizationsCreated: repositories.organizationsCreated,
          milestones: repositories.milestones,
          organizations: dependencies.organizations,
          sendBatch: (calls) => customerIo.batchOrThrow(calls),
          clock: { nowMs: () => nowInstant().epochMilliseconds },
        })
      : void 0;
    return new NurturingModule(
      buildNurturingPipeline({
        deliver: (input) => delivery.deliver(input),
        projectCreated: (data) => milestones.projectCreated(data),
        guidedTurnFailed: (data) => delivery.deliverGuidedTurnFailed(data),
        usageReportReceived: (input) => delivery.deliverUsageReport(input),
        evaluationsCompleted: (input) => milestones.evaluationsCompleted(input),
        simulationRunsFinished: (input) => milestones.simulationRunsFinished(input),
        codingSessionsStored: (input) => codingMilestones.sessionsStored(input),
      }),
      organizationUsage,
    );
  }

  /**
   * Whether the per-email usage syncs at all: only with a Customer.io channel. Without one, the
   * usage pipeline registers nothing, so no row is written that no sync would read or prune.
   */
  syncsOrganizationUsage(): boolean {
    return this.#organizationUsage !== undefined;
  }

  /** A project's usage or traces changed: its organization's traits go to Customer.io. */
  async organizationUsageChanged(input: Readonly<{ projectId: string }>): Promise<void> {
    await this.#organizationUsage?.usageChanged(input);
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
