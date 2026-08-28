import { type PrismaConnection, PrismaShutdownService } from "@langwatch/prisma-client";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";

/**
 * Whether `client` is the root client rather than an interactive-transaction
 * client. Prisma 7 removed `$transaction` from the transaction deny list —
 * transaction clients now carry a callable `$transaction` — so checking for it
 * stopped discriminating anything. `$connect` is still denied on transaction
 * clients; that judgment lives here, once, next to the client it describes.
 */
export const isRootPrismaClient = (
  client: PrismaClient | Prisma.TransactionClient,
): client is PrismaClient => "$connect" in client;

let connection: PrismaConnection | undefined;
let closing: Promise<void> | undefined;

function requirePrismaConnection(): PrismaConnection {
  if (!connection) {
    throw new Error("Prisma connection has not been composed for this process");
  }
  return connection;
}

/** A construction-free binding for legacy callers while executable boot owns composition. */
export function configurePrismaConnection(next: PrismaConnection): void {
  if (closing) {
    throw new Error("Prisma connection is closing for this process");
  }
  if (connection) {
    throw new Error("Prisma connection is already composed for this process");
  }
  connection = next;
}

/** Adopts one explicitly supplied process connection without constructing a fallback. */
export function adoptPrismaConnection(next: PrismaConnection): void {
  if (closing) {
    throw new Error("Prisma connection is closing for this process");
  }
  if (!connection) {
    connection = next;
    return;
  }
  if (connection !== next) {
    throw new Error("A different Prisma connection is already composed for this process");
  }
}

export function getPrismaConnection(): PrismaConnection {
  return requirePrismaConnection();
}

export function hasPrismaConnection(): boolean {
  return connection !== void 0;
}

export function closePrismaConnection(): Promise<void> {
  if (closing) return closing;
  if (!connection) return Promise.resolve();

  const activeConnection = connection;
  connection = void 0;
  closing = PrismaShutdownService.create().shutdown(activeConnection);
  void closing.then(
    () => {
      closing = void 0;
    },
    () => {
      closing = void 0;
    },
  );
  return closing;
}

/**
 * This compatibility proxy never constructs a client. Executable composition
 * supplies the one process connection before legacy callers use it.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    const client = requirePrismaConnection().client as unknown as Record<string | symbol, unknown>;
    const value = client[prop];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value;
  },
  has(_target, prop) {
    return prop in (requirePrismaConnection().client as object);
  },
});
