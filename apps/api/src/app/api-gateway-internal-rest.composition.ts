/**
 * The Go data plane's control-plane calls, filled from this process.
 *
 * `/api/internal/gateway` is the gateway's only way back into LangWatch: it
 * resolves a presented virtual key to a signed JWT, long-polls for revisions,
 * pulls a key's warm-cache bundle, checks a guardrail inline, reads an
 * attributed-user bucket, drains its spooled spend commands and books a voice
 * session. Every one of those runs against the SAME graph the console and the
 * public REST door read, which is the point of composing it here rather than
 * letting the family reach for a service locator.
 *
 * ## The three absences, and why each is a refusal rather than an answer
 *
 * **Guardrails** need an evaluator runtime. A process without one refuses the
 * check by name; it does not answer `allow`, because a protection that quietly
 * stops protecting is worse than one that is honestly unavailable.
 *
 * **Spend commands** need a registered gateway-spend pipeline. Without it the
 * route answers 503 `spend_pipeline_disabled` — which is the code the data
 * plane's drainer already spools against, so the batch is retried rather than
 * acked and lost.
 *
 * **Realtime voice sessions** need the spend confirmation path, because a
 * session booked with nowhere to report its usage is a call that runs and is
 * never billed. The gateway refuses the mint when this refuses, so the refusal
 * is the safe direction.
 *
 * The HMAC secret and the JWT signing key are two separate configuration
 * leaves and two separate facts: one authenticates the data plane's calls INTO
 * this process, the other is what this process mints credentials the data
 * plane presents onward with. Neither is logged, and neither is read here —
 * both arrive from the process's one configuration reader.
 *
 * ## The second door on the same session
 *
 * A brokered voice session is BOOKED on `/realtime/session` here and SETTLED
 * afterwards on the ElevenLabs post-call webhook, which is a public family of
 * its own. Both are composed in this module and both take the bag
 * {@link composeApiGatewayRealtimeSessions} builds, so the door that opens a
 * session and the door that closes it cannot be holding two connections, two
 * rating seams or two confirmations.
 */
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import {
  createElevenLabsWebhookRestApp,
  createGatewayInternalRestApp,
  GatewayConfigMaterialiser,
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
import { createGatewayChangeEventsPort } from "@langwatch/gateway-server/composition/gateway-change-events";
import type { MonitorService } from "@langwatch/monitor-contract";
import { readCustomKeys } from "@langwatch/model-provider-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { SecretEncryptionPort } from "@langwatch/secret-server";

import type { ApiGatewayGroupCollaborators } from "./api-trpc-collaborators.gateway-group.composition";

/**
 * The Codex OAuth refresh, as the gateway's recovery road reads it.
 *
 * Stated structurally rather than by importing the model-provider service's
 * own signature, so a process that composes no provider service simply passes
 * nothing and the route refuses by name.
 */
export type ApiGatewayCodexRefresh = (input: { providerRowId: string }) => Promise<
  | { status: "refreshed"; accessToken: string; accountId: string }
  | { status: "not_connected" }
  | { status: "session_expired" }
>;

export type ApiGatewayInternalRestOptions = Readonly<{
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  /** Everything the gateway composition opened, so both doors read one graph. */
  gateway: ApiGatewayGroupCollaborators["composition"];
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
   * The confirmation a settled voice session is reported through, if this
   * process registered the spend pipeline.
   *
   * The rest of what a brokered session is booked against — the connection and
   * the rating seam — is this module's own, so the collaborator bag is built
   * HERE rather than handed in: the settlement has to price a call through the
   * same seam the drained batch does, and two adapters would be two answers to
   * what one minute of audio cost.
   */
  spendConfirmation?: GatewaySpendConfirmationPort | undefined;
}>;

type GatewayInternalRestPortsGuardrails = ReturnType<
  NonNullable<GatewayInternalRestPorts["guardrails"]>
>;

/**
 * A provider row's stored keys, read through the SAME lenient reader the model
 * gateway itself uses.
 *
 * Lenient on purpose and transcribed rather than reinvented: a legacy
 * plaintext row, an absent column and a value written under a rotated key all
 * read as "no custom keys" instead of failing the whole config materialisation
 * — a bundle that cannot be built is a virtual key the data plane stops
 * serving, and one provider's unreadable credential must not do that.
 */
class ApiGatewayModelProviderCredentials extends GatewayModelProviderCredentialsPort {
  static create(encryption: SecretEncryptionPort): ApiGatewayModelProviderCredentials {
    return new ApiGatewayModelProviderCredentials(encryption);
  }

  private constructor(private readonly encryption: SecretEncryptionPort) {
    super();
  }

  readCustomKeys(stored: unknown): Record<string, unknown> {
    const read = readCustomKeys(stored, this.encryption);
    return read.state === "read" ? read.keys : {};
  }
}

/**
 * Composes the internal control plane, or reports that it cannot be served.
 *
 * `undefined` on two counts, and both are the whole family rather than a route.
 *
 * NO CIPHER: the warm-cache bundle names every provider a key may dispatch to,
 * and building it reads those providers' stored credentials. A family mounted
 * without the cipher would publish a bundle with no providers in it, which the
 * data plane serves as a key that can reach nothing — a silent outage rather
 * than a refusal.
 *
 * NO JWT SIGNING KEY: `/resolve-key` answers a presented virtual key with a
 * short-lived credential the data plane presents onward, and every other route
 * exists to keep that credential current. A process that cannot sign one has
 * no gateway to serve, so the door is honestly absent rather than mounted and
 * failing on its first call.
 *
 * The HMAC secret is deliberately NOT one of these. Its absence answers 500
 * `gateway_internal_secret_missing` at the door, which is the wire behaviour
 * the data plane already parses and the one that tells an operator which half
 * of the shared secret they forgot.
 */
export function composeApiGatewayInternalRest(
  options: ApiGatewayInternalRestOptions & { security: AppRestSecurity },
): MountableRestApp | undefined {
  const { prisma, gateway, projects, encryption } = options;
  const jwtSecret = options.jwtSecret?.trim();
  if (!encryption || !jwtSecret) return undefined;

  const store = PrismaGatewayInternalStoreAdapter.create({ database: prisma });
  const changes = createGatewayChangeEventsPort(prisma);
  const jwt = GatewayJwtAdapter.create({ secret: jwtSecret });
  const materialiser = new GatewayConfigMaterialiser(
    prisma,
    projects,
    gateway.budgetSpend ?? null,
    // The SAME decision store the console writes a budget through, so the
    // bundle the data plane enforces cannot disagree with what a customer set.
    gateway.budgetDecisions,
    ApiGatewayModelProviderCredentials.create(encryption),
  );
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
      ? { guardrails: () => ({ database: prisma, monitors, runEvaluator }) }
      : {}),
    ...(spendCommands ? { spend: () => ({ commands: spendCommands, rating }) } : {}),
    ...(realtimeSessions ? { realtimeSessions: () => realtimeSessions } : {}),
  };

  return createGatewayInternalRestApp({ security: options.security, ports });
}

/**
 * The realtime collaborator bag, published so a SECOND door can settle the
 * same session.
 *
 * A brokered voice session is booked here, on `/realtime/session`, and settled
 * afterwards on the ElevenLabs post-call webhook — two doors, one session row,
 * one money answer. Building the bag in one function is what makes that
 * structural: the webhook cannot be handed a different connection, a different
 * rating seam or a different confirmation than the booking used.
 *
 * A booked session must have somewhere to report its usage, so the whole bag
 * stands or falls with the confirmation. The trace span is the one member that
 * may be absent on its own: without trace storage the money still lands and the
 * call simply carries no cost line.
 *
 * `rating` is an argument so the internal family passes the instance it also
 * prices a drained spend batch with. A caller that passes none gets a fresh
 * `ModelCatalogGatewaySpendRatingAdapter`, which is the same ANSWER — the
 * adapter is a pure read of the static model catalogue and holds no state —
 * and, more to the point, the same adapter class the port was declared for.
 */
export function composeApiGatewayRealtimeSessions(options: {
  prisma: PrismaClient;
  spendConfirmation: GatewaySpendConfirmationPort | undefined;
  rating?: GatewaySpendRatingPort | undefined;
}): GatewayRealtimeSessionCollaborators | undefined {
  if (!options.spendConfirmation) return undefined;

  return {
    database: options.prisma,
    spendRating: options.rating ?? ModelCatalogGatewaySpendRatingAdapter.create(),
    spendConfirmation: options.spendConfirmation,
  };
}

/**
 * The ElevenLabs post-call webhook, over the SAME realtime bag the booking
 * uses.
 *
 * Its own family rather than a route on the internal control plane, because
 * the two are addressed differently and reached differently: `/api/internal/
 * gateway` is blocked at the ingress and called in-cluster with the shared
 * HMAC secret, and this one is the vendor's delivery target, public by
 * protocol and verified per delivery against the secret on the provider row
 * the path names. Customers never paste this URL anywhere — the documented one
 * is on the gateway, which relays the raw bytes here.
 *
 * Absent on two counts, and both leave the door OFF rather than answering:
 *
 * NO CIPHER: the per-tenant webhook secret is a stored credential on the
 * provider row. Without the cipher every delivery would fail its signature
 * check and answer 404, which reads to the vendor as "this endpoint does not
 * exist" and, after ten consecutive failures, disables the workspace's webhook
 * for every tenant on it.
 *
 * NO SPEND CONFIRMATION: a settled session has nowhere to report what the call
 * cost. Acknowledging the delivery anyway would consume the one report the
 * vendor sends and bill nothing; leaving the door off lets the reconciliation
 * worker's scheduled read remain the billing path it already is.
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
        database: options.prisma,
        credentials: ApiGatewayModelProviderCredentials.create(encryption),
      },
      sessions,
    },
  });
}
