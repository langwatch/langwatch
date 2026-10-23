/** A cluster name is spliced as an identifier, so only a plain one is trusted. */
export function isPlainClusterName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/** ClickHouse refusals of a cluster-wide read the local node may still answer, by code and name. */
const LOCAL_FALLBACK_REFUSALS: ReadonlyMap<string, string> = new Map([
  ["60", "UNKNOWN_TABLE"],
  ["170", "CLUSTER_DOESNT_EXIST"],
  ["497", "ACCESS_DENIED"],
]);

/**
 * Whether a cluster-wide system read was refused in a way the local node may still answer: a
 * replica without the table, a cluster ClickHouse does not know, or no right to read the others.
 * A timeout or any other failure is not, so it reaches the caller.
 */
export function isClusterReadRefusal(error: unknown): boolean {
  const detail = error as { code?: unknown; type?: unknown; message?: unknown } | null;
  if (LOCAL_FALLBACK_REFUSALS.has(String(detail?.code))) return true;
  const names = [...LOCAL_FALLBACK_REFUSALS.values()];
  if (typeof detail?.type === "string" && names.includes(detail.type)) return true;
  const message = typeof detail?.message === "string" ? detail.message : "";

  return names.some((name) => message.includes(name));
}
