// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { EventingCommands } from "@langwatch/eventing";

import type { ProjectActivity, UserActivity } from "../eventing/digest-activity.events.ts";
import type {
  DigestOrganizationPlanRequest,
  DigestSendRequest,
} from "../eventing/digest-send.events.ts";
import type { DigestSendPipeline } from "../eventing/digest-send.pipeline.ts";
import type { DigestPipeline } from "../eventing/digest.pipeline.ts";

/** Digest's own pipeline senders, bound once each pipeline is registered in this process. */
export class DigestCommandsService {
  static create(): DigestCommandsService {
    return new DigestCommandsService();
  }

  #activity: EventingCommands<DigestPipeline> | undefined;
  #send: EventingCommands<DigestSendPipeline> | undefined;

  private constructor() {}

  connectActivity(commands: EventingCommands<DigestPipeline>): void {
    this.#activity = commands;
  }

  connectSend(commands: EventingCommands<DigestSendPipeline>): void {
    this.#send = commands;
  }

  async recordProject(activity: ProjectActivity): Promise<void> {
    await this.#activityCommands().recordProjectActivity.send(activity);
  }

  async recordUser(activity: UserActivity): Promise<void> {
    await this.#activityCommands().recordUserActivity.send(activity);
  }

  /** One member's email for the week; `occurredAt` is the plan's instant. */
  async requestSend({
    occurredAt,
    ...request
  }: DigestSendRequest & { occurredAt: number }): Promise<void> {
    if (!this.#send) throw new Error("digest_send registered no senders in this process");
    await this.#send.requestSend.send({ tenantId: request.organizationId, occurredAt, ...request });
  }

  /** One organization's week to plan, as its own intent; `occurredAt` is the plan's instant. */
  async requestOrganizationPlan({
    occurredAt,
    ...request
  }: DigestOrganizationPlanRequest & { occurredAt: number }): Promise<void> {
    if (!this.#send) throw new Error("digest_send registered no senders in this process");
    await this.#send.requestOrganizationPlan.send({
      tenantId: request.organizationId,
      occurredAt,
      ...request,
    });
  }

  #activityCommands(): EventingCommands<DigestPipeline> {
    if (!this.#activity) {
      throw new Error("the digest pipeline registered no senders in this process");
    }
    return this.#activity;
  }
}
