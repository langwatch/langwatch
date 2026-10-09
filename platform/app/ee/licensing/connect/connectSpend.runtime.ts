/**
 * The process's one hosted-spend buffer, held apart from what builds it so the
 * shutdown sequence can flush it without importing the services behind it.
 *
 * One per process: it sums spend across requests, so a second one would split
 * the sums and double the writes.
 */

import type { ConnectSpendBuffer } from "./connectSpendBuffer";

let buffer: ConnectSpendBuffer | undefined;

export function sharedConnectSpendBuffer(
  create: () => ConnectSpendBuffer,
): ConnectSpendBuffer {
  return (buffer ??= create());
}

/** Writes pending hosted spend. A no-op in a process that served none. */
export async function flushConnectSpend(): Promise<void> {
  await buffer?.flush();
}
