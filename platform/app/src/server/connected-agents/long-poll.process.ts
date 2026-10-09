/**
 * The long-poll transport of this process: one per process, built on first
 * use by the connect routes and released at shutdown.
 */

import { env } from "~/env.mjs";
import { prisma } from "~/server/db";
import { LongPollTransport } from "./long-poll.transport";
import { getConnectedAgentRuntime } from "./runtime";

let processTransport: LongPollTransport | null = null;

/** The transport of this process, built on first use. */
export function getLongPollTransport(): LongPollTransport {
  processTransport ??= new LongPollTransport({
    runtime: getConnectedAgentRuntime(),
    prisma,
    replicaCount: env.LANGWATCH_APP_REPLICAS,
  });
  return processTransport;
}

/** Releases every waiting poll; the next read builds a fresh transport. */
export async function closeLongPollTransport(): Promise<void> {
  const transport = processTransport;
  processTransport = null;
  await transport?.close();
}
