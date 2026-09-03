import type { PipelineNode } from "@langwatch/ops-contract";

export interface SubscriberMeta {
  subscriberName: string;
  pipelineName: string;
  aggregateType: string;
  eventTypes: readonly string[];
}

export interface SubscriberHealthRow extends SubscriberMeta {
  pending: number;
  active: number;
  blocked: number;
  isPaused: boolean;
  /** The queue path a pause targets: `<pipeline>/subscriber/<name>`. */
  pauseKey: string;
  /** False when the live tree holds no node for this subscriber at all. */
  hasLiveNode: boolean;
}

/**
 * The subscriber's queue path. Load-bearing grammar: GroupQueue keys
 * subscriber groups `<tenant>/subscriber/<name>/…` and the pipeline tree
 * files them under `<pipeline>/subscriber/<name>`, so this exact shape is
 * what the pause set matches against.
 */
export function subscriberPauseKey(meta: { pipelineName: string; subscriberName: string }): string {
  return `${meta.pipelineName}/subscriber/${meta.subscriberName}`;
}

/**
 * Registry × live tree. Registry-driven on purpose: a subscriber with no
 * live jobs vanishes from the tree entirely, and "vanished" must not render
 * the same as "healthy" — the registry knows it exists, so it gets a row
 * with zeros and an explicit no-live-presence marker.
 */
export function joinSubscriberHealth({
  subscribers,
  pipelineTree,
  pausedKeys,
}: {
  subscribers: SubscriberMeta[];
  pipelineTree: PipelineNode[];
  pausedKeys: string[];
}): SubscriberHealthRow[] {
  const paused = new Set(pausedKeys);
  const live = new Map<string, { pending: number; active: number; blocked: number }>();
  for (const pipeline of pipelineTree) {
    for (const typeNode of pipeline.children) {
      if (typeNode.name !== "subscriber") continue;
      for (const nameNode of typeNode.children) {
        live.set(`${pipeline.name}/${nameNode.name}`, {
          pending: nameNode.pending,
          active: nameNode.active,
          blocked: nameNode.blocked,
        });
      }
    }
  }

  const rows = subscribers.map((meta) => {
    const counts = live.get(`${meta.pipelineName}/${meta.subscriberName}`);
    const pauseKey = subscriberPauseKey(meta);
    return {
      ...meta,
      pending: counts?.pending ?? 0,
      active: counts?.active ?? 0,
      blocked: counts?.blocked ?? 0,
      // Paused directly, or via an ancestor: pausing the whole pipeline (or
      // its subscriber tier) pauses this subscriber too, and the row must say
      // so rather than reserving "paused" for the exact-key case.
      isPaused:
        paused.has(pauseKey) ||
        paused.has(meta.pipelineName) ||
        paused.has(`${meta.pipelineName}/subscriber`),
      pauseKey,
      hasLiveNode: counts !== undefined,
    };
  });

  return rows.sort(
    (a, b) =>
      b.blocked - a.blocked ||
      b.pending - a.pending ||
      a.subscriberName.localeCompare(b.subscriberName),
  );
}
