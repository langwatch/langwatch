/**
 * `automation.*` and `emailSuppression.*` — the triggers a project fires on,
 * their channels, and who asked those channels to stop writing to them —
 * composed as one feature.
 *
 * Two namespaces, one feature, because they are one application: a suppression
 * is what an automation's mail honours, and a process holding one without the
 * other would offer a list of addresses nothing consults.
 *
 * The API process READS and WRITES those rows. It does not RUN them — the six
 * capabilities of the running half are named absences inside
 * {@link composeApiAutomationApp}, which is where they refuse.
 */
import {
  AutomationProviderRegistryAdapter,
  type AutomationApp,
  type EmailSuppressionTrpcPorts,
} from "@langwatch/automation-server";
import { HandledError } from "@langwatch/handled-error";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { SecretEncryptionPort } from "@langwatch/secret-server";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import { composeApiAutomationApp } from "../../app/api-automation.composition";
import {
  createAutomationTrpcRouter,
  createEmailSuppressionTrpcRouter,
  type AutomationMountPorts,
} from "./automation-trpc.mount";

/** The other services and deployment facts a trigger is read and written over. */
export type AutomationPeers = Readonly<{
  /** The project directory a trigger's own project is named through. */
  projects: ProjectService;
  /** The monitors a trigger watches, named in the trigger list. */
  monitors: MonitorService;
  /** The deployment's cipher, for the stored credentials a channel carries. */
  encryption: SecretEncryptionPort | undefined;
  /** The SAME Redis the worker spends the persist ceiling against. */
  redis: RedisConnection | null;
}>;

/** The two namespaces this feature mounts, and its `ctx.app` application. */
export type ComposedAutomationFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    automation: ReturnType<typeof createAutomationTrpcRouter>;
    emailSuppression: ReturnType<typeof createEmailSuppressionTrpcRouter>;
  };
  /** For `ctx.app.automation`. */
  app: AutomationApp;
  /**
   * The same application, where this process composed one, for the packaged
   * automation REST family and the one-click unsubscribe door. Published
   * separately because both doors are MOUNTED rather than refused: a mail
   * client following an unsubscribe link must not be answered by a family
   * standing over an application nobody composed.
   */
  service?: AutomationApp | undefined;
}>;

/** Composes both automation namespaces over this process's own graph. */
export function composeAutomationFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: AutomationPeers;
  /**
   * The process's ONE fixed-window counter. The same instance every other
   * throttle on this process meters through: two limiters would give one
   * caller two budgets.
   */
  rateLimit(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>>;
  /** The signing key an unsubscribe link is minted and verified with. */
  unsubscribeSecret: string | undefined;
  /** This deployment's public origin, for the links a trigger's mail carries. */
  baseHost: string;
  /** Names this process in the application's own refusals. */
  processName: string;
}): ComposedAutomationFeature {
  const { infrastructure, peers } = options;
  const providers = AutomationProviderRegistryAdapter.create(
    peers.encryption ?? new UnconfiguredApiCipher(),
  );

  const app = composeApiAutomationApp({
    prisma: infrastructure.prisma,
    projects: peers.projects,
    monitors: peers.monitors,
    featureFlags: infrastructure.featureFlags,
    plans: infrastructure.plans,
    providers,
    unsubscribeSecret: options.unsubscribeSecret,
    baseHost: options.baseHost,
    redis: peers.redis,
    processName: options.processName,
  });

  const automation: AutomationMountPorts = {
    rateLimit: (input) => options.rateLimit(input),
    listSlackChannels: () =>
      Promise.reject(
        new ApiAutomationUnavailableError(
          "Slack transport, so it cannot list a workspace's channels",
        ),
      ),
    providers: {
      actionParamsSchemaFor: (action) => providers.actionParamsSchemaFor(action),
      persistActionParamsFor: (action, args) => providers.persistActionParamsFor(action, args),
      redactActionParamsFor: (action, params) => providers.redactActionParamsFor(action, params),
      decryptSlackBotToken: (actionParams) => providers.decryptSlackBotToken(actionParams),
      decryptWebhookHeaders: (stored) => providers.decryptWebhookHeaders(stored),
      decryptWebhookSigningSecrets: (stored) => providers.decryptWebhookSigningSecrets(stored),
    },
  };

  const emailSuppression: EmailSuppressionTrpcPorts = {
    clientIp: (ctx) => (ctx as { clientIp?: () => string }).clientIp?.(),
    rateLimit: (input) => options.rateLimit(input),
    recordAudit: async (entry) => {
      await infrastructure.audit?.record({
        actorId: entry.userId,
        path: entry.action,
        input: {
          ...(entry.projectId === undefined ? {} : { projectId: entry.projectId }),
          ...((entry.args ?? {}) as Record<string, unknown>),
        },
        error: null,
      });
    },
  };

  return {
    app,
    service: app,
    routers: (mount) => ({
      automation: createAutomationTrpcRouter({ ...mount, ports: automation }),
      emailSuppression: createEmailSuppressionTrpcRouter({ ...mount, ports: emailSuppression }),
    }),
  };
}

/**
 * Both automation namespaces on a process that composed no trigger store.
 *
 * They still mount and every call refuses by name: an empty trigger list reads
 * as "this project automates nothing", which is a different statement from
 * "this process cannot see its automations".
 */
export function refusingAutomationFeature(): ComposedAutomationFeature {
  const refuse = (): never => {
    throw new ApiAutomationUnavailableError("automation store");
  };
  const refuseEvery = <T>(): T => new Proxy({}, { get: () => refuse, has: () => true }) as T;

  return {
    app: refuseEvery<AutomationApp>(),
    routers: (mount) => ({
      automation: createAutomationTrpcRouter({
        ...mount,
        ports: {
          rateLimit: () => refuse(),
          listSlackChannels: () => refuse(),
          providers: refuseEvery<AutomationMountPorts["providers"]>(),
        } as AutomationMountPorts,
      }),
      emailSuppression: createEmailSuppressionTrpcRouter({
        ...mount,
        ports: refuseEvery<EmailSuppressionTrpcPorts>(),
      }),
    }),
  };
}

/** The deployment's stored-secret cipher, or a refusal that names the variable. */
class UnconfiguredApiCipher {
  encrypt(): never {
    throw new ApiAutomationUnavailableError(
      "stored-secret key (CREDENTIALS_SECRET), so it cannot store an automation credential",
    );
  }

  decrypt(): never {
    throw new ApiAutomationUnavailableError(
      "stored-secret key (CREDENTIALS_SECRET), so it cannot read an automation credential",
    );
  }
}

/** A capability this deployment did not compose, refused by name. */
export class ApiAutomationUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiAutomationUnavailableError";
  }
}
