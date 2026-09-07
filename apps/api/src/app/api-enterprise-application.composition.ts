/**
 * The Enterprise application slot, composed MEMBER BY MEMBER over this process's own graph.
 *
 * `ApiEnterpriseApplicationPort` carries eight independent members and nothing composed any
 * of them, so every Enterprise surface on this process refused. Three of the eight are
 * reachable from what the API already holds, and they are what this module builds:
 *
 *   sessionPolicy  one Postgres repository behind one service
 *   webhooks       the endpoint registry, its delivery health, and the emitted-envelope log
 *   backoffice     the operator's single sign-on connection ledger
 *
 * The other five — `governance`, `governanceApp`, `scimApp`, `licensing`, `usageLimits` —
 * stay absent, and absent is a composed answer rather than an oversight: each waits on an
 * implementation no application in this repository has written yet (a licence storage port,
 * the billing notification graph, the fifteen governance ports). The consumer of each
 * member says so by name at boot and refuses by name when a customer reaches it.
 *
 * ## Two refusals this module states on purpose
 *
 * A webhook TEST FIRE is the delivery worker's last hop, and this process registers its
 * pipelines producer-only. It refuses by name rather than opening a second HTTP client that
 * only knows URLs — see the same decision, for the same reason, in
 * `api-gateway-webhooks.composition.ts`.
 *
 * The connection ledger APPENDS before it stages (ADR-101's order, which ADR-110 corrected
 * for the other three identity ledgers), and this process composes `EventStoreProducerOnly`.
 * So the back office READS here and its twelve commands refuse by name at the append. That
 * is strictly more than the whole namespace refusing, and the remaining half is a
 * stage-only connection ledger, which the identity package owes and does not yet have.
 */
import type { PlanProvider } from "@langwatch/entitlement-contract";
import {
  WebhookAccessService,
  WebhookApp,
  WebhookHealthService,
} from "@langwatch/enterprise-api/webhooks";
import { PostgresSessionPolicyAdapter } from "@langwatch/enterprise-governance-server";
import type { EventSourcing } from "@langwatch/eventing";
import { PrismaProcessStore } from "@langwatch/eventing/server";
import {
  PlatformOperatorPort,
  PostgresSsoConnectionPipelineAdapter,
  PrismaSsoConnectionBackofficeRepository,
  SsoConnectionBackofficeService,
} from "@langwatch/identity-server";
import type { Logger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SecretEncryptionPort } from "@langwatch/secret-server";

import type { ApiEnterpriseApplicationPort } from "../features/enterprise/enterprise.composition.ts";
import type { EnterpriseTrpcMountPorts } from "../features/enterprise/enterprise-trpc.mount.ts";
import {
  composeApiWebhookPlatform,
  type ApiWebhookClickHouseResolver,
} from "./api-gateway-webhooks.composition.ts";

/** The back office's connection ledger, in the shape the tRPC mount port asks for. */
type ApiSsoConnectionBackoffice = ReturnType<
  EnterpriseTrpcMountPorts["ssoConnections"]["backoffice"]
>;

/** Reports the composition decisions an absent collaborator would otherwise hide. */
export abstract class ApiEnterpriseApplicationAbsenceReport {
  /** No database: no session rules, no endpoint registry, no connection ledger. */
  abstract withoutDatabase(): void;
  /** A database but no at-rest cipher, which an endpoint's signing secret is written under. */
  abstract withoutWebhookCipher(): void;
  /** No queue, so no pipeline to stage a connection command onto. */
  abstract withoutConnectionLedger(): void;
  /** The five members nothing in this repository implements yet. */
  abstract withoutUnbuiltMembers(): void;
}

export type ApiEnterpriseApplicationOptions = Readonly<{
  /** The one guarded connection every member here runs on. */
  prisma: PrismaClient | undefined;
  /** The cipher an endpoint's signing secret is written under, or none. */
  encryption: SecretEncryptionPort | undefined;
  /** This process's ClickHouse, where the emitted webhook envelopes are projected. */
  resolveClickHouseClient: ApiWebhookClickHouseResolver | null;
  /**
   * The deployment's plan lookup. The webhook surface is gated on a PLAN rather than on an
   * Enterprise capability, so a deployment with no governance application still answers a
   * customer-actionable 403 instead of an unknown-error 503.
   */
  plans: PlanProvider | undefined;
  /** This process's producer-only eventing, where it composed a queue. */
  eventSourcing: EventSourcing | undefined;
  /** Who this deployment counts as a platform operator, for the connection guards. */
  operators: PlatformOperatorPort;
  report?: ApiEnterpriseApplicationAbsenceReport;
}>;

/**
 * Composes the members this process can serve, and leaves the rest absent.
 *
 * Always returns a port rather than `undefined`: a member is what is present or absent
 * here, and returning nothing would put the eight back behind one question.
 */
export function composeApiEnterpriseApplication(
  options: ApiEnterpriseApplicationOptions,
): ApiEnterpriseApplicationPort {
  const { prisma, report } = options;
  report?.withoutUnbuiltMembers();
  if (!prisma) {
    report?.withoutDatabase();
    return {};
  }

  const webhooks = composeWebhooks({ ...options, prisma });
  if (!webhooks) report?.withoutWebhookCipher();

  const backoffice = composeBackoffice({ ...options, prisma });
  if (!backoffice) report?.withoutConnectionLedger();

  return {
    sessionPolicy: PostgresSessionPolicyAdapter.create(prisma),
    ...(webhooks ? { webhooks } : {}),
    ...(backoffice ? { backoffice } : {}),
  };
}

/**
 * The endpoint registry, its delivery health and the emitted-envelope log, as one
 * application. Health is composed over the SAME registry and the SAME durable process store
 * the delivery stream lives in, which is how one endpoint's streak, rates and backlog are
 * three reads of one endpoint rather than three answers about it.
 */
function composeWebhooks(
  options: ApiEnterpriseApplicationOptions & { prisma: PrismaClient },
): WebhookApp | undefined {
  const platform = composeApiWebhookPlatform({
    database: options.prisma,
    encryption: options.encryption,
    resolveClickHouseClient: options.resolveClickHouseClient,
  });
  if (!platform) return undefined;

  const access = options.plans ? WebhookAccessService.create(options.plans) : undefined;

  return WebhookApp.create({
    endpoints: platform.endpoints,
    health: WebhookHealthService.create({
      endpoints: platform.endpoints,
      processStore: PrismaProcessStore.create({ database: options.prisma }),
    }),
    events: platform.events,
    assertEndpointsEntitled: access
      ? (organizationId) => access.assertEndpointsAvailable(organizationId)
      : () =>
          Promise.reject(
            new Error(
              "The API process composed no plan provider, so it cannot decide whether this organization is entitled to webhook endpoints.",
            ),
          ),
    // The worker that claims the shared queue signs and ships a batch; this
    // process registers its pipelines producer-only and runs no delivery
    // executor. A second HTTP client here would deliver bytes the receiver
    // could not verify against the endpoint's signing secret.
    dispatch: () =>
      Promise.reject(
        new Error(
          "The API process runs no webhook delivery process manager, so it cannot deliver a test fire to an endpoint's transport. This work belongs to the worker that claims the shared queue.",
        ),
      ),
  });
}

/**
 * The operator's connection ledger, over the SAME graph the pipeline commands through — one
 * set of guards, one break-glass budget, one ledger writer.
 */
function composeBackoffice(
  options: ApiEnterpriseApplicationOptions & { prisma: PrismaClient },
): (() => ApiSsoConnectionBackoffice) | undefined {
  const { prisma, eventSourcing, operators } = options;
  if (!eventSourcing) return undefined;

  const pipeline = PostgresSsoConnectionPipelineAdapter.create({
    database: prisma,
    eventSourcing,
    operators,
  });
  const service = SsoConnectionBackofficeService.create({
    reads: PrismaSsoConnectionBackofficeRepository.create(prisma),
    connections: () => pipeline.connections(),
  });
  const port = asBackofficePort(service);

  return () => port;
}

/**
 * The service, under the names the transport reads. One verb differs: the transport asks
 * `getById` for a read that answers `null`, and the service names that read `tryGetById`.
 */
function asBackofficePort(service: SsoConnectionBackofficeService): ApiSsoConnectionBackoffice {
  return {
    list: (input) => service.list(input),
    getById: (input) => service.tryGetById(input),
    registerConnection: (input) => service.registerConnection(input),
    claimDomain: (input) => service.claimDomain(input),
    approveDomainClaim: (input) => service.approveDomainClaim(input),
    rejectDomainClaim: (input) => service.rejectDomainClaim(input),
    attestDomain: (input) => service.attestDomain(input),
    activateConnection: (input) => service.activateConnection(input),
    suspendConnection: (input) => service.suspendConnection(input),
    resumeConnection: (input) => service.resumeConnection(input),
    requestTeardown: (input) => service.requestTeardown(input),
  };
}

/** Names each absence at boot, once per process. */
export class LoggedApiEnterpriseApplicationAbsence extends ApiEnterpriseApplicationAbsenceReport {
  static create(logger: Pick<Logger, "info">): LoggedApiEnterpriseApplicationAbsence {
    return new LoggedApiEnterpriseApplicationAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info">) {
    super();
  }

  withoutDatabase(): void {
    this.logger.info(
      { reason: "no-database" },
      "API composed no database, so it composed no Enterprise application member: the session rules, the webhook endpoints and the single sign-on back office all refuse by name",
    );
  }

  withoutWebhookCipher(): void {
    this.logger.info(
      { member: "webhooks", reason: "no-encryption" },
      "API composed no at-rest cipher, so it composed no webhook endpoint registry: an endpoint's signing secret is stored encrypted and a registry that could not read what it wrote would fail every delivery's signature",
    );
  }

  withoutConnectionLedger(): void {
    this.logger.info(
      { member: "backoffice", reason: "no-queue" },
      "API composed no Group Queue, so it composed no single sign-on connection ledger: the operator back office refuses by name",
    );
  }

  withoutUnbuiltMembers(): void {
    this.logger.info(
      {
        members: ["governance", "governanceApp", "scimApp", "licensing", "usageLimits"],
      },
      "API composes no Enterprise governance capability, governance application, SCIM application, licence store or usage-limit store: each waits on an implementation no application in this repository has written, and every surface over them refuses by name",
    );
  }
}
