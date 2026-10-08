import { ConfigurationError } from "../services/errorHandling.ts";

/**
 * A lane key the previous release queued jobs under, consumed by this pipeline's successor lane for
 * one release (round 49 E4), as `UpcastDrain` drains a former pipeline and round 16's retired lanes
 * drained a living one. Spec: packages/eventing/specs/lane-alias.feature.
 */
export interface LaneAlias {
  /** The former key, `<pipeline>:<jobType>:<name>`, as the previous release's jobs carry it. */
  readonly from: string;
  /** This pipeline's lane that takes them: its own lane, or its peer lane of that name. */
  readonly to: { readonly jobType: string; readonly lane: string };
  /** The event types this successor takes, when the former lane split across several. */
  readonly eventTypes?: readonly string[];
  /** The former body as the successor reads it; absent, a reactor's body unwraps to its event. */
  readonly data?: (stored: unknown) => unknown;
  /** The release that ships the alias: once it is cut, the next one must not carry it. */
  readonly removeAfter: string;
}

/** A pipeline's aliases as its built definition carries them, for the runtime and window check. */
export interface PipelineLaneAliases {
  readonly pipeline: string;
  readonly aliases: readonly LaneAlias[];
}

const LANE_KEY = /^[^:]+:[^:]+:.+$/;
const RELEASE = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** `3.21.0` or `v3.21.0` as comparable numbers; null when it is no release. */
function parseRelease(release: string): readonly [number, number, number] | null {
  const match = RELEASE.exec(release.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function releaseAtOrAfter({ release, floor }: { release: string; floor: string }): boolean {
  const left = parseRelease(release);
  const right = parseRelease(floor);
  if (!left || !right) return false;
  const order = left.map((part, index) => part - (right[index] ?? 0)).find((diff) => diff !== 0);
  return (order ?? 0) >= 0;
}

/** Refuses, when the pipeline is built, an alias that could never apply or never ends. */
export function assertLaneAliasesDeclarable({
  pipeline,
  aliases,
}: {
  pipeline: string;
  aliases: readonly LaneAlias[];
}): void {
  const claimed = new Map<string, Set<string>>();
  for (const alias of aliases) {
    const refuse = (details: string) =>
      new ConfigurationError("PipelineBuilder", `Pipeline "${pipeline}" ${details}`, {
        pipeline,
        from: alias.from,
        to: `${alias.to.jobType}:${alias.to.lane}`,
      });
    if (!LANE_KEY.test(alias.from)) {
      throw refuse(`aliases "${alias.from}", which is not a <pipeline>:<jobType>:<name> key.`);
    }
    if (laneAliasTargetKeys({ pipeline, to: alias.to }).includes(alias.from)) {
      throw refuse(`aliases "${alias.from}" to itself.`);
    }
    if (!parseRelease(alias.removeAfter)) {
      throw refuse(`aliases "${alias.from}" with no release that ends it.`);
    }
    const types = claimed.get(alias.from) ?? new Set<string>();
    for (const type of alias.eventTypes ?? ["*"]) {
      if (types.has(type) || types.has("*") || (type === "*" && types.size > 0)) {
        throw refuse(`aliases "${alias.from}" twice for the event type "${type}".`);
      }
      types.add(type);
    }
    claimed.set(alias.from, types);
  }
}

/** The registry keys an alias's successor may sit under: this pipeline's lane, then its peer. */
export function laneAliasTargetKeys({
  pipeline,
  to,
}: {
  pipeline: string;
  to: LaneAlias["to"];
}): readonly string[] {
  return [`${pipeline}:${to.jobType}:${to.lane}`, `global:${to.jobType}:${pipeline}.${to.lane}`];
}

/** The former body as the successor reads it: the declared transform, else a reactor's event. */
export function readAliasedBody({
  alias,
  stored,
}: {
  alias: LaneAlias;
  stored: Record<string, unknown>;
}): Record<string, unknown> {
  if (alias.data) return toRecord(alias.data(stored));
  const formerJobType = alias.from.split(":")[1];
  if (formerJobType !== "reactor" || alias.to.jobType === "reactor") return stored;
  return toRecord(stored.event);
}

/** Whether an alias's successor takes a former job: it names no event types, or the job's type. */
export function laneAliasTakes({
  alias,
  stored,
}: {
  alias: LaneAlias;
  stored: Record<string, unknown>;
}): boolean {
  if (!alias.eventTypes) return true;
  const type = formerEventType(stored);
  return type !== undefined && alias.eventTypes.includes(type);
}

/** The type a former job carried: an event body's own, or a reactor body's event's. */
function formerEventType(stored: Record<string, unknown>): string | undefined {
  if (typeof stored.type === "string") return stored.type;
  const event = toRecord(stored.event);
  return typeof event.type === "string" ? event.type : undefined;
}

/** The aliases whose window has closed: the release that shipped them has been cut. */
export function laneAliasesPastWindow({
  declared,
  newestRelease,
}: {
  declared: readonly PipelineLaneAliases[];
  newestRelease: string;
}): readonly { pipeline: string; from: string; removeAfter: string }[] {
  return declared.flatMap(({ pipeline, aliases }) =>
    aliases
      .filter((alias) => releaseAtOrAfter({ release: newestRelease, floor: alias.removeAfter }))
      .map(({ from, removeAfter }) => ({ pipeline, from, removeAfter })),
  );
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? { ...value } : {};
}
