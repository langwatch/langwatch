import type { Logger } from "@langwatch/observability";
import type { PrismaPg } from "@prisma/adapter-pg";
import type { Pool } from "pg";

import type { PrismaConfiguration } from "./config.ts";
import { PrismaDriverAdapterService, type PrismaDriverAdapterFactory } from "./driver-adapter.ts";
import { type Prisma, PrismaClient } from "./generated/client.ts";

/**
 * A short constant name per Prisma log level, used as the pino `msg` so a
 * filtered console reads the event kind without opening the line.
 */
const PRISMA_EVENT_MESSAGE: Record<Prisma.LogLevel, string> = {
  error: "prisma error",
  warn: "prisma warning",
  info: "prisma info",
  query: "prisma query",
};

/** Prisma's `query` level has no logger counterpart, so it lands as debug. */
function prismaLoggerLevel(level: Prisma.LogLevel): "error" | "warn" | "info" | "debug" {
  return level === "query" ? "debug" : level;
}

/** A query event carries `query` where a log event carries `message`. */
function prismaEventMessage(event: Prisma.LogEvent | Prisma.QueryEvent): string {
  return "query" in event ? event.query : event.message;
}

/** Forwards one Prisma client event to the process logger as one structured line. */
export function forwardPrismaEvent({
  logger,
  level,
  event,
}: {
  logger: Logger;
  level: Prisma.LogLevel;
  event: Prisma.LogEvent | Prisma.QueryEvent;
}): void {
  logger[prismaLoggerLevel(level)](
    { target: event.target, message: prismaEventMessage(event), timestamp: event.timestamp },
    PRISMA_EVENT_MESSAGE[level],
  );
}

export interface PrismaQueryContext {
  model?: string | undefined;
  action: string;
  args: unknown;
}

export type PrismaQueryExecutor = (args: unknown) => Promise<unknown>;

/**
 * Tenancy policy port that prevents unguarded client construction.
 * Centralized here so all processes use the same rules.
 */
export abstract class PrismaQueryGuard {
  abstract execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown>;
}

export interface PrismaClientFactoryInput {
  adapter: PrismaPg;
  log: Prisma.LogLevel[];
  logger: Logger;
}

export abstract class PrismaClientFactory {
  abstract create(input: PrismaClientFactoryInput): PrismaClient;
}

class GeneratedPrismaClientFactory extends PrismaClientFactory {
  create(input: PrismaClientFactoryInput): PrismaClient {
    const client = new PrismaClient({
      adapter: input.adapter,
      log: input.log.map((level) => ({ level, emit: "event" as const })),
    });
    for (const level of input.log) {
      client.$on(level, (event) => forwardPrismaEvent({ logger: input.logger, level, event }));
    }
    return client;
  }
}

export interface PrismaConnectionServiceOptions {
  guard: PrismaQueryGuard;
  logger: Logger;
  driverAdapter?: PrismaDriverAdapterFactory | undefined;
  clientFactory?: PrismaClientFactory | undefined;
}

/** The resources returned together to their process composition root. */
export class PrismaConnection {
  private closePromise: Promise<void> | undefined;

  private constructor(
    readonly client: PrismaClient,
    readonly pool: Pool,
  ) {}

  static create(input: { client: PrismaClient; pool: Pool }): PrismaConnection {
    return new PrismaConnection(input.client, input.pool);
  }

  /** @internal Prefer PrismaShutdownService from composition code. */
  closeOnce(): Promise<void> {
    this.closePromise ??= (async () => {
      try {
        await this.client.$disconnect();
      } finally {
        await this.pool.end();
      }
    })();
    return this.closePromise;
  }
}

/** Explicit, side-effect-free-until-called Prisma/Postgres construction. */
export class PrismaConnectionService {
  private readonly guard: PrismaQueryGuard;
  private readonly driverAdapter: PrismaDriverAdapterFactory;
  private readonly clientFactory: PrismaClientFactory;
  private readonly logger: Logger;

  private constructor({
    guard,
    driverAdapter,
    clientFactory,
    logger,
  }: {
    guard: PrismaQueryGuard;
    driverAdapter: PrismaDriverAdapterFactory;
    clientFactory: PrismaClientFactory;
    logger: Logger;
  }) {
    this.guard = guard;
    this.driverAdapter = driverAdapter;
    this.clientFactory = clientFactory;
    this.logger = logger;
  }

  static create(options: PrismaConnectionServiceOptions): PrismaConnectionService {
    return new PrismaConnectionService({
      guard: options.guard,
      driverAdapter: options.driverAdapter ?? PrismaDriverAdapterService.create(),
      clientFactory: options.clientFactory ?? new GeneratedPrismaClientFactory(),
      logger: options.logger,
    });
  }

  connect(configuration: PrismaConfiguration): PrismaConnection {
    const { adapter, pool } = this.driverAdapter.create(configuration.databaseUrl);
    const client = this.clientFactory.create({
      adapter,
      log: configuration.log,
      logger: this.logger,
    });
    const guard = this.guard;

    const guarded = client.$extends({
      query: {
        $allModels: {
          $allOperations({ model, operation, args, query }) {
            return guard.execute({ model, action: operation, args }, (guardedArgs) =>
              query(guardedArgs as typeof args),
            );
          },
        },
        $queryRaw({ args, query }) {
          return guard.execute({ action: "queryRaw", args }, (guardedArgs) =>
            query(guardedArgs as typeof args),
          );
        },
        $queryRawUnsafe({ args, query }) {
          return guard.execute({ action: "queryRaw", args }, (guardedArgs) =>
            query(guardedArgs as typeof args),
          );
        },
        $executeRaw({ args, query }) {
          return guard.execute({ action: "executeRaw", args }, (guardedArgs) =>
            query(guardedArgs as typeof args),
          );
        },
        $executeRawUnsafe({ args, query }) {
          return guard.execute({ action: "executeRaw", args }, (guardedArgs) =>
            query(guardedArgs as typeof args),
          );
        },
      },
    }) as unknown as PrismaClient;

    return PrismaConnection.create({ client: guarded, pool });
  }
}
