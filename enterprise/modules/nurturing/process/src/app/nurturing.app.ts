// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  NurturingApi,
  nurturingConfig,
  nurturingSecrets,
  type NurturingServerConfig,
  type NurturingSignal,
} from "@langwatch/enterprise-nurturing-contract";
import type { EventingCommands } from "@langwatch/eventing";
import type { FeatureSetup } from "@langwatch/kernel";
import { UserApi } from "@langwatch/user-contract";

import { postHogChannels } from "../channels/posthog-channels.registry.ts";
import { buildNurturingPipeline, type NurturingPipeline } from "../eventing/nurturing.pipeline.ts";
import { NurturingDeliveryService } from "../services/nurturing-delivery.service.ts";
import { NurturingService } from "../services/nurturing.service.ts";

type NurturingMembers = Readonly<{
  idempotency: Readonly<{ claim(key: string, ttlSeconds: number): Promise<boolean> }>;
}>;

type NurturingSetup = FeatureSetup<
  typeof NurturingApp.dependencies,
  NurturingMembers,
  NurturingServerConfig
>;

/** Owners tell nurturing; it names no peer, so it can never close a cycle (§9). */
export class NurturingApp implements NurturingApi {
  static readonly contract = NurturingApi;
  static readonly dependencies = { users: UserApi };
  static readonly reads = ["idempotency"] as const;
  static readonly config = nurturingConfig;
  static readonly secrets = nurturingSecrets;

  readonly #pipeline: NurturingPipeline;
  #commands: EventingCommands<NurturingPipeline> | undefined;

  private constructor(pipeline: NurturingPipeline) {
    this.#pipeline = pipeline;
  }

  static async create({
    config,
    dependencies,
    members,
    resources,
    secrets,
  }: NurturingSetup): Promise<NurturingApp> {
    const customerIo = await secrets.into(nurturingSecrets.customerIoApiKey, (key) =>
      key
        ? NurturingService.create({
            config: { customerIoApiKey: key, customerIoRegion: config.customerIoRegion },
          })
        : void 0,
    );
    const { posthogKey: key, posthogHost: host } = config;
    const posthog = key
      ? postHogChannels.live.create({ targets: () => [{ key, ...(host ? { host } : {}) }] })
      : void 0;
    if (posthog) resources.own("Nurturing PostHog client", () => posthog.close());

    const delivery = NurturingDeliveryService.create({
      claims: members.idempotency,
      customerIo,
      posthog,
      users: dependencies.users,
    });
    return new NurturingApp(
      buildNurturingPipeline({ deliver: (input) => delivery.deliver(input) }),
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
