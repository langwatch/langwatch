import type {
  AuthzGrantsService,
  AuthzService,
  LedgerPrincipal,
  LedgerScope,
} from "@langwatch/authz-contract";
import type { AuthzPipeline } from "@langwatch/authz-server";
import {
  AuthzGrantsCommandDispatcher,
  type AuthzGrantsCommandSenders,
  AuthzLedgerUnavailableError,
  deriveAuthzGrantId,
  LEDGER_APP_HANDLE_WAIT_MS,
  ObservabilityAuthzCutoverAdapter,
  PostgresAuthzAdapter,
  type PostgresAuthzDatabase,
} from "@langwatch/authz-server";
import type { SystemMigration } from "@langwatch/system-migrations";
import type { Cluster, Redis } from "ioredis";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  getAuthzDirectProjectionWriteCounter,
  getAuthzEngineGateReadFailuresCounter,
} from "~/server/metrics";

export type AuthzRuntimeContext = {
  database: PrismaClient;
  redis: Redis | Cluster | null;
  newBindingId: () => string;
  cacheEnabled: () => boolean;
  demoProjectId: () => string | undefined;
  now?: () => number;
};

/** Late binding between package-owned commands and the app's pipeline registry. */
class AppAuthzCommandDispatcher extends AuthzGrantsCommandDispatcher {
  private senders: AuthzGrantsCommandSenders | undefined;
  private readonly waiters = new Set<
    (senders: AuthzGrantsCommandSenders) => void
  >();

  connect(senders: AuthzGrantsCommandSenders): void {
    if (this.senders && this.senders !== senders) {
      throw new Error("AuthZ command dispatcher is already connected.");
    }
    this.senders = senders;
    for (const resolve of this.waiters) resolve(senders);
    this.waiters.clear();
  }

  async commands(): Promise<{ commands: AuthzGrantsCommandSenders }> {
    if (this.senders) return { commands: this.senders };

    const senders = await new Promise<AuthzGrantsCommandSenders>(
      (resolve, reject) => {
        const onConnected = (value: AuthzGrantsCommandSenders) => {
          clearTimeout(timeout);
          this.waiters.delete(onConnected);
          resolve(value);
        };
        const timeout = setTimeout(() => {
          this.waiters.delete(onConnected);
          reject(new AuthzLedgerUnavailableError());
        }, LEDGER_APP_HANDLE_WAIT_MS);
        this.waiters.add(onConnected);
      },
    );
    return { commands: senders };
  }
}

class AppAuthzRevocationTelemetry {
  record({
    reason,
  }: {
    organizationId: string;
    reason: "revocation" | "offboard";
    grantCount: number;
  }): void {
    getAuthzDirectProjectionWriteCounter(reason).inc();
  }
}

/**
 * Request/worker composition for AuthZ. It is the only application module
 * that knows the server package; callers receive the two contract services.
 */
export class AuthzFeature {
  static deriveGrantId(input: {
    organizationId: string;
    principal: LedgerPrincipal;
    scope: LedgerScope;
    resourceToken?: string;
    occurredAtMs: number;
  }): string {
    return deriveAuthzGrantId(input);
  }

  static create(context: AuthzRuntimeContext): AuthzFeature {
    const dispatcher = new AppAuthzCommandDispatcher();
    const built = PostgresAuthzAdapter.create({
      database: context.database as unknown as PostgresAuthzDatabase,
      redis: context.redis,
      dispatcher,
      cutoverReporter: ObservabilityAuthzCutoverAdapter.create({
        counter: getAuthzEngineGateReadFailuresCounter(),
      }),
      revocationTelemetry: new AppAuthzRevocationTelemetry(),
      newBindingId: context.newBindingId,
      cacheEnabled: context.cacheEnabled,
      demoProjectId: context.demoProjectId,
      ...(context.now ? { now: context.now } : {}),
    }).build();
    return new AuthzFeature(dispatcher, built);
  }

  private constructor(
    private readonly dispatcher: AppAuthzCommandDispatcher,
    private readonly built: Readonly<{
      authz: AuthzService;
      grants: AuthzGrantsService;
      pipeline: AuthzPipeline;
      migration: SystemMigration;
    }>,
  ) {}

  get permissions(): AuthzService {
    return this.built.authz;
  }

  get grants(): AuthzGrantsService {
    return this.built.grants;
  }

  get pipeline(): AuthzPipeline {
    return this.built.pipeline;
  }

  get migration(): SystemMigration {
    return this.built.migration;
  }

  connect(commands: AuthzGrantsCommandSenders): void {
    this.dispatcher.connect(commands);
  }
}
