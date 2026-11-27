// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { AnalyticsApi } from "@langwatch/analytics-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import {
  DigestApi,
  type DigestApi as DigestApiContract,
  digestConfig,
  type DigestServerConfig,
} from "@langwatch/enterprise-digest-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EventingCommands } from "@langwatch/eventing";
import { ReactEmailMailRenderer } from "@langwatch/mail";
import { OpsApi } from "@langwatch/ops-contract";
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
import { DigestOperatorsService } from "../services/digest-operators.service.ts";
import { DigestSendService } from "../services/digest-send.service.ts";
import { DigestSettingsService } from "../services/digest-settings.service.ts";
import { DigestSourceService } from "../services/digest-source.service.ts";
import { DigestTraceReadService } from "../services/digest-trace-read.service.ts";
import { DigestUnsubscribeService } from "../services/digest-unsubscribe.service.ts";
import { DigestUserErasureService } from "../services/digest-user-erasure.service.ts";
import { DigestWeekService } from "../services/digest-week.service.ts";

type DigestSetup = FeatureSetup<
  typeof DigestModule.dependencies,
  DigestServerConfig,
  DigestRepositories,
  DigestChannels
>;

/**
 * The weekly digest, on for every organization. Operators arm the send through Cloud admin; the
 * week's folds pick each member's template per organization, which is rendered and sent through
 * our own mailer, and each person's opt-out is honoured here (ADR-001, ADR-002).
 */
export class DigestModule implements DigestApiContract {
  static readonly contract = DigestApi;
  static readonly dependencies = {
    /** The week's trace numbers per project, read when an email is composed. */
    analytics: AnalyticsApi,
    /** Which of the week's projects each member may view; the email shows no other. */
    authz: AuthzApi,
    /** Admits Cloud admin staff, and answers not_found where cloud ops is off. */
    ops: OpsApi,
    /** Every organization, who its members are, which are admins, and its name. */
    organizations: OrganizationApi,
    /** An organization's projects and each project's organization, a personal project's owner, a project's name. */
    projects: ProjectApi,
    /**
     * The address each email goes to, read at send time and never stored; and whether the
     * person an unsubscribe link names still exists.
     */
    users: UserApi,
    /** The month's usage against the plan, read once per organization's send. */
    entitlement: EntitlementApi,
  };
  static readonly config = digestConfig;
  /** Unsubscribe links are signed with auth's session key, as automation's are (ADR-031). */
  static readonly secrets = { unsubscribe: sessionSecret } as const;

  readonly #operators: DigestOperatorsService;
  readonly #commands: DigestCommandsService;
  readonly #settings: DigestSettingsService;
  readonly #sends: DigestSendService;
  readonly #unsubscribes: DigestUnsubscribeService;
  readonly #pipeline: DigestPipeline;
  readonly #sendPipeline: DigestSendPipeline;

  private constructor(parts: {
    operators: DigestOperatorsService;
    commands: DigestCommandsService;
    settings: DigestSettingsService;
    sends: DigestSendService;
    unsubscribes: DigestUnsubscribeService;
    pipeline: DigestPipeline;
    sendPipeline: DigestSendPipeline;
  }) {
    this.#operators = parts.operators;
    this.#commands = parts.commands;
    this.#settings = parts.settings;
    this.#sends = parts.sends;
    this.#unsubscribes = parts.unsubscribes;
    this.#pipeline = parts.pipeline;
    this.#sendPipeline = parts.sendPipeline;
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
      limits: repositories.callCounter,
      audience: repositories.audience,
      users: dependencies.users,
      now: nowEpochMs,
    });
    const source = DigestSourceService.create({
      projects: dependencies.projects,
      recordProject: (activity) => commands.recordProject(activity),
      recordUser: (activity) => commands.recordUser(activity),
    });
    const weeks = DigestWeekService.create({
      traces: DigestTraceReadService.create({ analytics: dependencies.analytics, now: nowEpochMs }),
      projectWeeks: repositories.projectWeeks,
      userWeeks: repositories.userWeeks,
      entitlement: dependencies.entitlement,
    });
    const sends = DigestSendService.create({
      audience: repositories.audience,
      sends: repositories.sends,
      weeks,
      organizations: dependencies.organizations,
      projects: dependencies.projects,
      access: dependencies.authz,
      users: dependencies.users,
      mail: channels.mail,
      renderer: ReactEmailMailRenderer.create(),
      unsubscribes,
      publicBaseUrl: config.publicBaseUrl,
      requestSend: (request) => commands.requestSend(request),
      requestOrganizationPlan: (request) => commands.requestOrganizationPlan(request),
      now: nowEpochMs,
    });
    return new DigestModule({
      operators: DigestOperatorsService.create({ ops: dependencies.ops }),
      commands,
      settings: DigestSettingsService.create({ audience: repositories.audience, now: nowEpochMs }),
      sends,
      unsubscribes,
      pipeline: buildDigestPipeline({
        projectWeeks: repositories.projectWeeks,
        userWeeks: repositories.userWeeks,
        source,
        erasure: DigestUserErasureService.create({
          audience: repositories.audience,
          sends: repositories.sends,
          userWeeks: repositories.userWeeks,
        }),
      }),
      sendPipeline: buildDigestSendPipeline({ runner: sends, weeks }),
    });
  }

  /** The fold pipeline `digest` registers, built once by {@link create}. */
  pipeline(): DigestPipeline {
    return this.#pipeline;
  }

  connectCommands(commands: EventingCommands<DigestPipeline>): void {
    this.#commands.connectActivity(commands);
  }

  /** The send pipeline `digest_send`, built once by {@link create}. */
  sendPipeline(): DigestSendPipeline {
    return this.#sendPipeline;
  }

  connectSendCommands(commands: EventingCommands<DigestSendPipeline>): void {
    this.#commands.connectSend(commands);
  }

  setArmed: DigestApiContract["setArmed"] = async ({ operator, armed }) => {
    await this.#operators.admitManager(operator);
    return this.#settings.setArmed({ armed });
  };

  sendTest: DigestApiContract["sendTest"] = async ({ operator, organizationId, userId }) => {
    await this.#sends.sendTest({
      organizationId,
      userId,
      operatorId: await this.#operators.admitManager(operator),
    });
  };

  sendMyTests: DigestApiContract["sendMyTests"] = async ({ operator }) =>
    this.#sends.sendMyTests({ operatorId: await this.#operators.admitManager(operator) });

  getPreference: DigestApiContract["getPreference"] = (input) => this.#settings.preference(input);

  setPreference: DigestApiContract["setPreference"] = (input) =>
    this.#settings.setPreference(input);

  isSubscribed: DigestApiContract["isSubscribed"] = (input) =>
    this.#unsubscribes.isSubscribed(input);

  unsubscribe: DigestApiContract["unsubscribe"] = (input) => this.#unsubscribes.unsubscribe(input);

  resubscribe: DigestApiContract["resubscribe"] = (input) => this.#unsubscribes.resubscribe(input);
}
