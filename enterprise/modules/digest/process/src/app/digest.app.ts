// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  DigestApi,
  type DigestApi as DigestApiContract,
  digestConfig,
  type DigestServerConfig,
} from "@langwatch/enterprise-digest-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EventingCommands, ProcessStore } from "@langwatch/eventing";
import { OpsApi, type OpsOperator } from "@langwatch/ops-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import type { FeatureSetup } from "@langwatch/process";
import { ProjectApi } from "@langwatch/project-contract";
import { sessionSecret } from "@langwatch/secrets";
import { nowEpochMs } from "@langwatch/time";
import { UserApi } from "@langwatch/user-contract";

import type { DigestChannels } from "../channels/digest.channels.ts";
import {
  buildDigestSendPipeline,
  type DigestSendPipeline,
} from "../eventing/digest-send.pipeline.ts";
import { buildDigestPipeline, type DigestPipeline } from "../eventing/digest.pipeline.ts";
import type { DigestRepositories } from "../repositories/digest.repositories.ts";
import { DigestCommandsService } from "../services/digest-commands.service.ts";
import { DigestSendService } from "../services/digest-send.service.ts";
import { DigestSettingsService } from "../services/digest-settings.service.ts";
import { DigestSourceService } from "../services/digest-source.service.ts";
import { DigestUnsubscribeService } from "../services/digest-unsubscribe.service.ts";
import { DigestWeekService } from "../services/digest-week.service.ts";

type DigestSetup = FeatureSetup<
  typeof DigestModule.dependencies,
  DigestServerConfig,
  DigestRepositories,
  DigestChannels
>;

/**
 * The weekly digest. Operators enrol organizations and arm the send through Cloud admin; the
 * week's folds pick each member's template, which is rendered and sent through our own mailer,
 * and the one-click unsubscribe is honoured here (ADR-001).
 */
export class DigestModule implements DigestApiContract {
  static readonly contract = DigestApi;
  static readonly dependencies = {
    /** Admits Cloud admin staff, and answers not_found where cloud ops is off. */
    ops: OpsApi,
    /** Who an enrolled organization's members are, which are admins, and its name. */
    organizations: OrganizationApi,
    /** An enrolled organization's projects, a personal project's owner, a project's name. */
    projects: ProjectApi,
    /** The address each email goes to, read at send time and never stored. */
    users: UserApi,
    /** The month's usage against the plan, read once per organization's send. */
    entitlement: EntitlementApi,
  };
  static readonly config = digestConfig;
  /** Unsubscribe links are signed with auth's session key, as automation's are (ADR-031). */
  static readonly secrets = { unsubscribe: sessionSecret } as const;

  readonly #ops: Pick<OpsApi, "admitCloudAdmin" | "admitOperator">;
  readonly #commands: DigestCommandsService;
  readonly #settings: DigestSettingsService;
  readonly #sends: DigestSendService;
  readonly #unsubscribes: DigestUnsubscribeService;
  readonly #pipeline: DigestPipeline;

  private constructor(parts: {
    ops: Pick<OpsApi, "admitCloudAdmin" | "admitOperator">;
    commands: DigestCommandsService;
    settings: DigestSettingsService;
    sends: DigestSendService;
    unsubscribes: DigestUnsubscribeService;
    pipeline: DigestPipeline;
  }) {
    this.#ops = parts.ops;
    this.#commands = parts.commands;
    this.#settings = parts.settings;
    this.#sends = parts.sends;
    this.#unsubscribes = parts.unsubscribes;
    this.#pipeline = parts.pipeline;
  }

  static create(setup: DigestSetup): Promise<DigestModule> {
    return setup.secrets.into(DigestModule.secrets.unsubscribe, (secret) =>
      DigestModule.#compose({ setup, secret }),
    );
  }

  static #compose({
    setup: { dependencies, repositories, channels, config },
    secret,
  }: {
    setup: DigestSetup;
    secret: string | undefined;
  }): DigestModule {
    const commands = DigestCommandsService.create();
    const unsubscribes = DigestUnsubscribeService.create({
      secret,
      audience: repositories.audience,
      now: nowEpochMs,
    });
    const source = DigestSourceService.create({
      audience: repositories.audience,
      projects: dependencies.projects,
      recordProject: (activity) => commands.recordProject(activity),
      recordUser: (activity) => commands.recordUser(activity),
      now: nowEpochMs,
    });
    const sends = DigestSendService.create({
      audience: repositories.audience,
      sends: repositories.sends,
      projectWeeks: repositories.projectWeeks,
      userWeeks: repositories.userWeeks,
      weeks: DigestWeekService.create({
        projectWeeks: repositories.projectWeeks,
        userWeeks: repositories.userWeeks,
        entitlement: dependencies.entitlement,
      }),
      organizations: dependencies.organizations,
      projects: dependencies.projects,
      users: dependencies.users,
      mail: channels.mail,
      unsubscribes,
      publicBaseUrl: config.publicBaseUrl,
      requestSend: (request) => commands.requestSend(request),
      now: nowEpochMs,
    });
    return new DigestModule({
      ops: dependencies.ops,
      commands,
      settings: DigestSettingsService.create({ audience: repositories.audience }),
      sends,
      unsubscribes,
      pipeline: buildDigestPipeline({
        projectWeeks: repositories.projectWeeks,
        userWeeks: repositories.userWeeks,
        source,
      }),
    });
  }

  /** The fold pipeline `digest` registers, built once by {@link create}. */
  pipeline(): DigestPipeline {
    return this.#pipeline;
  }

  connectCommands(commands: EventingCommands<DigestPipeline>): void {
    this.#commands.connectActivity(commands);
  }

  /** The send pipeline `digest_send`; the hosting process lends the store its plan rows prune. */
  sendPipeline({ processStore }: { processStore: ProcessStore }): DigestSendPipeline {
    return buildDigestSendPipeline({
      runner: this.#sends,
      deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
    });
  }

  connectSendCommands(commands: EventingCommands<DigestSendPipeline>): void {
    this.#commands.connectSend(commands);
  }

  setEnrolled: DigestApiContract["setEnrolled"] = async ({ operator, organizationId, enrolled }) =>
    this.#settings.setEnrolled({ organizationId, enrolled, by: await this.#manager(operator) });

  setArmed: DigestApiContract["setArmed"] = async ({ operator, armed }) => {
    await this.#manager(operator);
    return this.#settings.setArmed({ armed });
  };

  sendTest: DigestApiContract["sendTest"] = async ({ operator, organizationId, userId }) =>
    this.#sends.sendTest({ organizationId, userId, operatorId: await this.#manager(operator) });

  isSubscribed: DigestApiContract["isSubscribed"] = ({ token }) =>
    this.#unsubscribes.isSubscribed({ token });

  unsubscribe: DigestApiContract["unsubscribe"] = ({ token }) =>
    this.#unsubscribes.unsubscribe({ token });

  resubscribe: DigestApiContract["resubscribe"] = ({ token }) =>
    this.#unsubscribes.resubscribe({ token });

  /** Cloud admin staff who hold `ops:manage`; anyone else learns nothing of the surface (§3.5). */
  async #manager(operator: OpsOperator | null): Promise<string> {
    const staff = await this.#ops.admitCloudAdmin(operator);
    await this.#ops.admitOperator(operator, "ops:manage");
    return staff.id;
  }
}
