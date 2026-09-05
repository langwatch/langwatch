/**
 * The Go data plane's control-plane calls, filled from this process.
 */
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import {
  createElevenLabsWebhookRestApp,
  createGatewayInternalRestApp,
  GatewayConfigAssemblyAdapter,
  GatewayConfigMaterialiserService,
  GatewayJwtAdapter,
  GatewayModelProviderCredentialsPort,
  ModelCatalogGatewaySpendRatingAdapter,
  PrismaGatewayInternalStoreAdapter,
  type GatewayInternalRestPorts,
  type GatewayRealtimeSessionCollaborators,
  type GatewaySpendCommandSender,
  type GatewaySpendConfirmationPort,
  type GatewaySpendRatingPort,
} from "@langwatch/gateway-server";
import { PrismaGatewayChangeEventsRepository } from "@langwatch/gateway-server/composition/gateway-change-events";
import { PrismaGatewayGuardrailRepository } from "@langwatch/gateway-server/composition/gateway-guardrails";
import { PrismaGatewayElevenLabsCredentialRepository } from "@langwatch/gateway-server/composition/gateway-elevenlabs-credentials";
import type { MonitorService } from "@langwatch/monitor-contract";
import { EncryptedModelProviderCredentialAdapter } from "@langwatch/model-provider-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { SecretEncryptionPort } from "@langwatch/secret-server";

import type { ApiGatewayComposition } from "./api-gateway.composition";
import { PrismaGatewayScopeResolutionRepository } from "@langwatch/gateway-server/composition/gateway-scope-resolution";
import { GatewayScopeResolutionService } from "@langwatch/gateway-server";
import { PrismaGatewayRealtimeSessionRepository } from "@langwatch/gateway-server/composition/gateway-realtime-sessions";

/**
 * The Codex OAuth refresh, as the gateway's recovery road reads it. Stated structurally
 * rather than by importing the model-provider service's own signature, so a process that
 * composes no provider service simply passes nothing and the route refuses by name.
 */
export type ApiGatewayCodexRefresh = (input: {
  providerRowId: string;
}) => Promise<
  | { status: "refreshed"; accessToken: string; accountId: string }
  | { status: "not_connected" }
  | { status: "session_expired" }
>;

export type ApiGatewayInternalRestOptions = Readonly<{
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  /** Everything the gateway composition opened, so both doors read one graph. */
  gateway: ApiGatewayComposition;
  /** The project directory a key's trace destination is resolved through. */
  projects: ProjectService;
  /** The HMAC secret the data plane signs its calls with, where configured. */
  internalSecret: string | undefined;
  /** The key the credentials handed to the data plane are signed under. */
  jwtSecret: string | undefined;
  /** The cipher a provider row's stored keys were written under, if any. */
  encryption: SecretEncryptionPort | undefined;
  /** The monitor directory a guardrail attachment names, if composed. */
  monitors?: MonitorService | undefined;
  /** Runs one evaluator for a guardrail check, if this process can. */
  runEvaluator?: GatewayInternalRestPortsGuardrails["runEvaluator"] | undefined;
  /** Refreshes a provider row's Codex session, if this process can. */
  refreshCodex?: ApiGatewayCodexRefresh | undefined;
  /** The spend pipeline's command senders and its rating seam, if registered. */
  spendCommands?: Record<string, GatewaySpendCommandSender | undefined> | undefined;
  /**
   * The confirmation a settled voice session is reported through, if this process
   * registered the spend pipeline.
   */
  spendConfirmation?: GatewaySpendConfirmationPort | undefined;
}>;

type GatewayInternalRestPortsGuardrails = ReturnType<
  NonNullable<GatewayInternalRestPorts["guardrails"]>
>;

/**
 * A provider row's stored keys, read through the SAME lenient reader the model gateway
 * itself uses.
 */
class ApiGatewayModelProviderCredentials extends GatewayModelProviderCredentialsPort {
  static create(encryption: SecretEncryptionPort): ApiGatewayModelProviderCredentials {
    return new ApiGatewayModelProviderCredentials(encryption);
  }

  private constructor(private readonly encryption: SecretEncryptionPort) {
    super();
  }

  readCustomKeys(stored: unknown): Record<string, unknown> {
    const read = EncryptedModelProviderCredentialAdapter.readCustomKeys(stored, this.encryption);
    return read.state === "read" ? read.keys : {};
  }
}

/**
 * Composes the internal control plane, or reports that it cannot be served. `undefined`
 * on two counts, and both are the whole family rather than a route.
 */
export function composeApiGatewayInternalRest(
  options: ApiGatewayInternalRestOptions & { security: AppRestSecurity },
): MountableRestApp | undefined {
  const { prisma, gateway, projects, encryption } = options;
  const jwtSecret = options.jwtSecret?.trim();
  if (!encryption || !jwtSecret) return undefined;

  const store = PrismaGatewayInternalStoreAdapter.create({ database: prisma });
  const changes = PrismaGatewayChangeEventsRepository.create(prisma);
  const jwt = GatewayJwtAdapter.create({ secret: jwtSecret });
  const materialiser = GatewayConfigMaterialiserService.create({
    scopeResolution: GatewayScopeResolutionService.create({
      repository: PrismaGatewayScopeResolutionRepository.create({ database: prisma }),
    }),
    projects,
    chRepo: gateway.budgetSpend ?? null,
    // The SAME decision store the console writes a budget through, so the
    // bundle the data plane enforces cannot disagree with what a customer set.
    budgetDecisions: gateway.budgetDecisions,
    credentials: ApiGatewayModelProviderCredentials.create(encryption),
    assembly: GatewayConfigAssemblyAdapter.create({ prisma }),
    langyMirrorProjectId: process.env.LANGY_MIRROR_PROJECT_ID,
  });
  const rating = ModelCatalogGatewaySpendRatingAdapter.create();

  const monitors = options.monitors;
  const runEvaluator = options.runEvaluator;
  const spendCommands = options.spendCommands;
  const realtimeSessions = composeApiGatewayRealtimeSessions({
    prisma,
    spendConfirmation: options.spendConfirmation,
    rating,
  });

  const ports: GatewayInternalRestPorts = {
    internalSecret: () => options.internalSecret,
    virtualKeys: () => gateway.virtualKeys,
    projects: () => projects,
    jwt: () => jwt,
    store: () => store,
    changes: () => changes,
    config: () => materialiser,
    budgetSpend: () => gateway.budgetSpend,
    ...(options.refreshCodex ? { refreshCodex: options.refreshCodex } : {}),
    ...(monitors && runEvaluator
      ? {
          guardrails: () => ({
            repository: PrismaGatewayGuardrailRepository.create(prisma),
            monitors,
            runEvaluator,
          }),
        }
      : {}),
    ...(spendCommands ? { spend: () => ({ commands: spendCommands, rating }) } : {}),
    ...(realtimeSessions ? { realtimeSessions: () => realtimeSessions } : {}),
  };

  return createGatewayInternalRestApp({ security: options.security, ports });
}

/**
 * The realtime collaborator bag, published so a SECOND door can settle the same session.
 * A brokered voice session is booked here, on `/realtime/session`, and settled afterwards
 * on the ElevenLabs post-call webhook — two doors, one session row, one money answer.
 */
export function composeApiGatewayRealtimeSessions(options: {
  prisma: PrismaClient;
  spendConfirmation: GatewaySpendConfirmationPort | undefined;
  rating?: GatewaySpendRatingPort | undefined;
}): GatewayRealtimeSessionCollaborators | undefined {
  if (!options.spendConfirmation) return undefined;

  return {
    sessions: PrismaGatewayRealtimeSessionRepository.create({ database: options.prisma }),
    spendRating: options.rating ?? ModelCatalogGatewaySpendRatingAdapter.create(),
    spendConfirmation: options.spendConfirmation,
  };
}

/**
 * The ElevenLabs post-call webhook, over the SAME realtime bag the booking uses.
 */
export function composeApiElevenLabsWebhookRest(options: {
  security: AppRestSecurity;
  /** The one guarded connection the provider row and the session row are read on. */
  prisma: PrismaClient;
  /** The cipher the row's webhook secret was written under, if any. */
  encryption: SecretEncryptionPort | undefined;
  /** The confirmation a settled session's spend is reported through, if any. */
  spendConfirmation: GatewaySpendConfirmationPort | undefined;
}): MountableRestApp | undefined {
  const { encryption } = options;
  const sessions = composeApiGatewayRealtimeSessions({
    prisma: options.prisma,
    spendConfirmation: options.spendConfirmation,
  });
  if (!encryption || !sessions) return undefined;

  return createElevenLabsWebhookRestApp({
    security: options.security,
    ports: {
      credentials: {
        providers: PrismaGatewayElevenLabsCredentialRepository.create({
          database: options.prisma,
        }),
        credentials: ApiGatewayModelProviderCredentials.create(encryption),
      },
      sessions,
    },
  });
}
