/**
 * Keeps each trace_summaries trace's latest version by dropping the versions a newer one
 * replaced: that set stays small once parts merge, where a set of every latest version grows
 * with the window. specs/traces-v2/latest-version-dedup.feature
 */
export function latestTraceVersionOnly({
  where,
  alias,
}: {
  where: string;
  alias?: string;
}): string {
  const column = (name: string) => (alias ? `${alias}.${name}` : name);
  return `(sipHash128(${column("TenantId")}, ${column("TraceId")}), ${column("UpdatedAt")}) NOT IN (
    SELECT id, arrayJoin(arrayFilter(version -> version != latest, versions))
    FROM (
      SELECT sipHash128(TenantId, TraceId) AS id, groupArray(UpdatedAt) AS versions,
        max(UpdatedAt) AS latest
      FROM trace_summaries
      WHERE ${where}
      GROUP BY id
      HAVING length(versions) > 1
    )
  )`;
}
