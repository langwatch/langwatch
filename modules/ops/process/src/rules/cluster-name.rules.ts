/** A cluster name is spliced as an identifier, so only a plain one is trusted. */
export function isPlainClusterName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

const UNKNOWN_CLUSTER = { code: "170", name: "CLUSTER_DOESNT_EXIST" } as const;

/**
 * Whether a cluster-wide read failed because ClickHouse does not know the named cluster, the one
 * refusal the local node answers for. A timeout, missing rights or a missing table is not.
 */
export function isUnknownClusterError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? String(error.code) : "";
  const type = "type" in error ? error.type : undefined;
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  return (
    code === UNKNOWN_CLUSTER.code ||
    type === UNKNOWN_CLUSTER.name ||
    message.includes(UNKNOWN_CLUSTER.name)
  );
}
