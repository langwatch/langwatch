// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  NurturingApi,
  nurturingConfig,
  nurturingSecrets,
  type NurturingServerConfig,
  type NurturingSignal,
} from "@langwatch/enterprise-nurturing-contract";
import type { EventingCommands } from "@langwatch/eventing";
import type { FeatureSetup } from "@langwatch/process";
import { UserApi } from "@langwatch/user-contract";

import type { NurturingChannels } from "../channels/nurturing.channels.ts";
import { buildNurturingPipeline, type NurturingPipeline } from "../eventing/nurturing.pipeline.ts";
import type { NurturingRepositories } from "../repositories/nurturing.repositories.ts";
import { NurturingDeliveryService } from "../services/nurturing-delivery.service.ts";
import { NurturingMilestonesService } from "../services/nurturing-milestones.service.ts";
import { NurturingService } from "../services/nurturing.service.ts";

type NurturingSetup = FeatureSetup<
  typeof NurturingModule.dependencies,
  never,
  NurturingServerConfig,
  NurturingRepositories,
  NurturingChannels
>;

/** Owners tell nurturing; it names no peer, so it can never close a cycle (§9). */
export class NurturingModule implements NurturingApi {
  static readonly contract = NurturingApi;
  static readonly dependencies = { users: UserApi };
  static readonly config = nurturingConfig;
  static readonly secrets = nurturingSecrets;

  readonly #pipeline: NurturingPipeline;
  #commands: EventingCommands<NurturingPipeline> | undefined;

  private constructor(pipeline: NurturingPipeline) {
    this.#pipeline = pipeline;
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
    });
    const milestones = NurturingMilestonesService.create({
      milestones: repositories.milestones,
      claims: repositories.claims,
    });
    return new NurturingModule(
      buildNurturingPipeline({
        deliver: (input) => delivery.deliver(input),
        projectCreated: (data) => milestones.projectCreated(data),
        guidedTurnFailed: (data) => delivery.deliverGuidedTurnFailed(data),
        evaluationCompleted: (input) => milestones.evaluationCompleted(input),
        simulationRunFinished: (input) => milestones.simulationRunFinished(input),
      }),
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

  /** The nurturing pipeline this module registers, built once by {@link create}. */
  pipeline(): NurturingPipeline {
    return this.#pipeline;
  }

  /** Binds the built pipeline's own senders. */
  connectCommands(commands: EventingCommands<NurturingPipeline>): void {
    this.#commands = commands;
  }
}
