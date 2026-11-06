// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  NurturingApi,
  nurturingConfig,
  nurturingSecrets,
  type NurturingServerConfig,
  type NurturingSignal,
} from "@langwatch/enterprise-nurturing-contract";
import { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { EventingCommands } from "@langwatch/eventing";
import { OrganizationApi } from "@langwatch/organization-contract";
import type { FeatureSetup } from "@langwatch/process";
import { PromptApi } from "@langwatch/prompt-contract";
import { ScenarioApi } from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";
import { TraceApi } from "@langwatch/trace-contract";
import { UserApi } from "@langwatch/user-contract";

import type { NurturingChannels } from "../channels/nurturing.channels.ts";
import { buildNurturingPipeline, type NurturingPipeline } from "../eventing/nurturing.pipeline.ts";
import type { NurturingRepositories } from "../repositories/nurturing.repositories.ts";
import { nurturingOperatorReads } from "../repositories/prisma/prisma.nurturing-usage-organizations.repository.ts";
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

/** Owners tell nurturing; no module names it as a peer, so it can never close a cycle (§9). */
export class NurturingModule implements NurturingApi {
  static readonly contract = NurturingApi;
  static readonly dependencies = {
    users: UserApi,
    organizations: OrganizationApi,
    /** The daily usage sync's counts, each read from its owner. */
    prompts: PromptApi,
    evaluators: EvaluatorApi,
    scenarios: ScenarioApi,
    traces: TraceApi,
  };
  static readonly config = nurturingConfig;
  static readonly secrets = nurturingSecrets;
  static readonly operatorReads: Readonly<Record<string, unknown>> = nurturingOperatorReads;

  readonly #pipeline: NurturingPipeline;
  /** Absent where the deployment named no Customer.io key. */
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
    const organizationUsage =
      customerIo &&
      NurturingOrganizationUsageService.create({
        organizations: repositories.usageOrganizations,
        projects: repositories.projects,
        claims: repositories.claims,
        customerIo,
        prompts: dependencies.prompts,
        evaluators: dependencies.evaluators,
        scenarios: dependencies.scenarios,
        traces: dependencies.traces,
      });
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

  async recordSignal(signal: NurturingSignal): Promise<void> {
    if (!this.#commands) throw new Error("nurturing pipeline senders are not connected yet");
    await this.#commands.recordSignal.send({
      tenantId: signal.tenantId,
      occurredAt: signal.occurredAt,
      signal,
    });
  }

  /** The daily usage sync for the UTC day of `now`; nothing where Customer.io is not configured. */
  async syncOrganizationUsage(input: { now: number }): Promise<void> {
    await this.#organizationUsage?.syncAll(input);
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
