/**
 * Collapse a fan-out into one row per cluster.
 *
 * A single trace fans out into hundreds of groups whose identifiers differ only
 * by a trailing index — `…/trace:023eaa…:41`, `…:52`, `…:15` — and whose every
 * other column reads the same. Rendered flat that is two hundred rows saying
 * one thing, with the identifier eating the width that state should have.
 *
 * Clustering is on the identifier's stem: everything up to the final `:`
 * segment when that segment is a bare index. Groups that do not share a stem
 * are never merged, so unrelated pipelines keep their own rows.
 */

export interface ClusterableGroup {
  queueName: string;
  groupId: string;
  pendingJobs: number;
  oldestJobMs: number | null;
}

export interface GroupCluster<T extends ClusterableGroup> {
  /** Shared identifier stem, or the whole identifier for a lone group. */
  key: string;
  /** Stem rendered for humans; equals the identifier when the cluster is one. */
  label: string;
  members: T[];
  /** Σ pending across members — what the fan-out actually costs. */
  totalPendingJobs: number;
  /** Oldest wait across members: the worst case, not an average. */
  oldestJobMs: number | null;
}

/**
 * Split a trailing bare-index segment off an identifier.
 *
 * Only a final segment that is entirely digits counts. A trailing segment with
 * any other content is part of the identity — collapsing on it would merge
 * genuinely different groups, which is worse than showing a long list.
 */
export function splitIndexedSuffix(groupId: string): {
  stem: string;
  index: string | null;
} {
  const lastColon = groupId.lastIndexOf(":");
  if (lastColon <= 0) return { stem: groupId, index: null };
  const suffix = groupId.slice(lastColon + 1);
  if (suffix.length === 0 || !/^\d+$/.test(suffix)) {
    return { stem: groupId, index: null };
  }
  return { stem: groupId.slice(0, lastColon), index: suffix };
}

export function clusterGroups<T extends ClusterableGroup>(
  groups: T[],
): GroupCluster<T>[] {
  const byKey = new Map<string, GroupCluster<T>>();

  for (const group of groups) {
    const { stem, index } = splitIndexedSuffix(group.groupId);
    // A group with no index suffix is its own cluster. Keying it by the queue
    // as well keeps two queues' identically-named groups apart.
    const key =
      index === null
        ? `${group.queueName}::${group.groupId}`
        : `${group.queueName}::${stem}`;

    const existing = byKey.get(key);
    if (existing) {
      existing.members.push(group);
      existing.totalPendingJobs += group.pendingJobs;
      existing.oldestJobMs = olderOf(existing.oldestJobMs, group.oldestJobMs);
      continue;
    }

    byKey.set(key, {
      key,
      label: index === null ? group.groupId : stem,
      members: [group],
      totalPendingJobs: group.pendingJobs,
      oldestJobMs: group.oldestJobMs,
    });
  }

  return Array.from(byKey.values()).sort(
    (a, b) => b.totalPendingJobs - a.totalPendingJobs,
  );
}

/** Lower timestamp = longer wait. Nulls never win over a real timestamp. */
function olderOf(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/**
 * Elide the MIDDLE of an over-long identifier.
 *
 * Right-truncation is useless here: every ksuid in a project shares its prefix,
 * so `project_LVYcVYGW1AJ…` is indistinguishable from every sibling. Both ends
 * carry the information, so both ends survive.
 */
export function middleEllipsis(value: string, maxLength = 48): string {
  if (maxLength <= 1) return "…";
  if (value.length <= maxLength) return value;
  const keep = maxLength - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return tail === 0
    ? `${value.slice(0, head)}…`
    : `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}
