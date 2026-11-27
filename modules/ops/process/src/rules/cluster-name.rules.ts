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

/** The trusted cluster name, or an empty string where none is named or it is not plain. */
export function plainClusterName({ cluster }: { cluster: string | undefined }): string {
  const name = cluster?.trim() ?? "";
  return isPlainClusterName(name) ? name : "";
}

/** A system table across every replica of a named cluster, else on the local node. */
export function clusterSystemTable({
  cluster,
  table,
}: {
  cluster: string | undefined;
  table: string;
}): string {
  const name = plainClusterName({ cluster });
  return name ? `clusterAllReplicas('${name}', system.${table})` : `system.${table}`;
}

/** One unreachable replica must not blank the reading the others can still answer. */
export function clusterReadSettings({
  cluster,
}: {
  cluster: string | undefined;
}): Record<string, number> {
  return plainClusterName({ cluster }) ? { skip_unavailable_shards: 1 } : {};
}

/**
 * The read across the named cluster, or on the local node when ClickHouse does not know the
 * cluster (`fellBack` and its `cause`, for the caller to log). `cluster` names where it ran.
 * Any other failure is thrown, never hidden behind the local node.
 */
export async function readAcrossClusterOrLocal<T>({
  cluster,
  read,
}: {
  cluster: string | undefined;
  read: (cluster: string | undefined) => Promise<T>;
}): Promise<{ answer: T; cluster: string | undefined; fellBack: boolean; cause?: unknown }> {
  const name = plainClusterName({ cluster });
  if (!name) return { answer: await read(void 0), cluster: void 0, fellBack: false };
  try {
    return { answer: await read(name), cluster: name, fellBack: false };
  } catch (error) {
    if (!isUnknownClusterError(error)) throw error;
    return { answer: await read(void 0), cluster: void 0, fellBack: true, cause: error };
  }
}
