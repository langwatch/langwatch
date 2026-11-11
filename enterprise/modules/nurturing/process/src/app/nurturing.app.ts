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
import { OrganizationApi } from "@langwatch/organization-contract";
import type { FeatureSetup } from "@langwatch/process";
import { nowInstant } from "@langwatch/time";
import { UserApi } from "@langwatch/user-contract";

import type { NurturingChannels } from "../channels/nurturing.channels.ts";
import { buildNurturingPipeline, type NurturingPipeline } from "../eventing/nurturing.pipeline.ts";
import type { NurturingRepositories } from "../repositories/nurturing.repositories.ts";
import type { UncopiedProjectOutcome } from "../rules/nurturing-project-usage.rules.ts";
import { NurturingCodingMilestonesService } from "../services/nurturing-coding-milestones.service.ts";
import { NurturingDeliveryService } from "../services/nurturing-delivery.service.ts";
import { NurturingMemberFactsService } from "../services/nurturing-member-facts.service.ts";
import { NurturingMilestonesService } from "../services/nurturing-milestones.service.ts";
import { NurturingOrganizationUsageService } from "../services/nurturing-organization-usage.service.ts";
import { NurturingProjectFactsService } from "../services/nurturing-project-facts.service.ts";
import { NurturingUncopiedProjectsService } from "../services/nurturing-uncopied-projects.service.ts";
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
  readonly #organizationUsage: NurturingOrganizationUsageService | undefined;
  readonly #uncopiedProjects: NurturingUncopiedProjectsService;
  #commands: EventingCommands<NurturingPipeline> | undefined;

  private constructor({
    pipeline,
    organizationUsage,
    uncopiedProjects,
  }: Readonly<{
    pipeline: NurturingPipeline;
    organizationUsage: NurturingOrganizationUsageService | undefined;
    uncopiedProjects: NurturingUncopiedProjectsService;
  }>) {
    this.#pipeline = pipeline;
    this.#organizationUsage = organizationUsage;
    this.#uncopiedProjects = uncopiedProjects;
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
          members: repositories.members,
          sendBatch: (calls) => customerIo.batchOrThrow(calls),
          clock: { nowMs: () => nowInstant().epochMilliseconds },
        })
      : void 0;
    const projectFacts = NurturingProjectFactsService.create({
      personalProjects: repositories.personalProjects,
      tracedProjects: repositories.tracedProjects,
      logger: createLogger("langwatch:nurturing:project-facts"),
    });
    const userErasure = NurturingUserErasureService.create({
      personalProjects: repositories.personalProjects,
      organizations: repositories.milestones,
      members: repositories.members,
    });
    const uncopiedProjects = NurturingUncopiedProjectsService.create({
      uncopiedProjects: repositories.uncopiedProjects,
      clock: { nowMs: () => nowInstant().epochMilliseconds },
    });
    return new NurturingModule({
      pipeline: buildNurturingPipeline({
        deliver: (input) => delivery.deliver(input),
        projectCreated: (data) => milestones.projectCreated(data),
        guidedTurnFailed: (data) => delivery.deliverGuidedTurnFailed(data),
        usageReportReceived: (input) => delivery.deliverUsageReport(input),
        evaluationsCompleted: (input) => milestones.evaluationsCompleted(input),
        simulationRunsFinished: (input) => milestones.simulationRunsFinished(input),
        codingSessionsStored: (input) => codingMilestones.sessionsStored(input),
        recordPersonalOwner: (input) => projectFacts.recordPersonalOwner(input),
        recordTracedProject: (input) => projectFacts.recordTracedProject(input),
        forgetErasedUser: (input) => userErasure.forgetUser(input),
      }),
      organizationUsage,
      uncopiedProjects,
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

  /** Whether this process already dropped a project with no placement copy. */
  uncopiedProjectDropped(input: Readonly<{ projectId: string }>): boolean {
    return this.#uncopiedProjects.isDropped(input);
  }

  /** A trace batch of a project nurturing has no placement copy of: retried, or dropped. */
  uncopiedProjectOutcome(input: Readonly<{ projectId: string }>): Promise<UncopiedProjectOutcome> {
    return this.#uncopiedProjects.outcomeOf(input);
  }

  /** A project's placement copy was written: it is no longer uncopied. */
  async uncopiedProjectCopied(input: Readonly<{ projectId: string }>): Promise<void> {
    await this.#uncopiedProjects.copyLanded(input);
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
