/**
 * The queue lane a grant command waits in (ADR-114).
 *
 * ADR-110 made a grant its own AGGREGATE, which is what stopped one fold
 * state from being every grant an organization holds. Because a command's
 * group key defaults to `${aggregateType}:${getAggregateId(payload)}`
 * (queueManager.ts), that also gave every grant its own LANE — a lane of
 * one, which nothing else can ever join and so nothing can ever batch with.
 *
 * For interactive access changes that is the right shape and this module
 * changes nothing about them: they arrive one at a time, so a lane holds one
 * command and coalescing folds a batch of one, which is the pre-existing
 * path exactly. For a bulk producer it is the wrong shape. On 2026-08-23 a
 * migration restated 428,720 facts for one organization and each fact
 * appended its own single-row insert into `event_log`, saturating the
 * ClickHouse statement limiter (200 slots, ~1s a statement) for ninety
 * minutes. Every job on the fleet — customer span ingestion included — then
 * spent 5.7 of its 6.3 seconds waiting for a slot.
 *
 * So the lane becomes the organization — which the framework already puts in
 * every key — divided into shards:
 *
 *   before   one lane per grant   g1 -> 1 insert          (x 428,720)
 *   after    32 lanes per org     0  -> [g1 g33 ...] 1 insert  (x 32)
 *
 * Aggregate identity and lane identity were the same string only by
 * default. This separates them, which is what `getGroupKey` on
 * `CommandHandlerOptions` exists for. The FOLD is untouched: state is still
 * one grant, keyed by its own id, exactly as ADR-110 decided.
 *
 * Sharding rather than one lane per organization is the whole point of the
 * shape. A single organization-wide lane would serialize every grant command
 * an organization makes and could be slower than the per-grant lanes it
 * replaces, batching or not.
 *
 * Sharding is safe HERE in a way it is not everywhere. The coding-agent
 * pipeline coalesces without sharding because its derivation depends on
 * per-session order, and a shard would break it. A grant command carries no
 * such dependency: two commands about the SAME grant share an aggregate id,
 * so they hash to the same shard and stay ordered, while two commands about
 * DIFFERENT grants are different aggregates whose order was never meaningful.
 * Commands of different TYPES already sat in different lanes before this
 * change — the job path carries the command name — so nothing that was
 * ordered stops being ordered.
 *
 * @see dev/docs/adr/114-grant-command-lanes-and-the-statement-budget.md
 * @see specs/event-sourcing/authz-grant-command-lanes.feature
 */
import {
  clampShardCount,
  shardIndexFor,
} from "../../../pipeline/commandShardKey";

/**
 * Upper bound on the lane count for one organization. Lanes buy parallelism
 * and batches buy statement economy; past this the batches get too small to
 * pay for themselves and the statement pressure this exists to remove comes
 * back.
 */
export const MAX_GRANT_SHARD_COUNT = 64;

/**
 * Lanes per organization. 32 keeps a bulk import wide enough to use the
 * fleet while cutting its statement count by the batch factor; an
 * organization's ordinary traffic never fills one lane, let alone 32.
 */
export const GRANT_SHARD_COUNT = 32;

/**
 * How many of a lane's queued commands fold into one multi-row append.
 *
 * The commands qualify for coalescing on the ADR-066 contract without any
 * change: `grantsLedgerCommands.ts` states it in its own words — "the grant
 * commands are pure appends: validate, stamp identity, emit". Each handler
 * derives its event from its own command alone and never reads back a
 * same-batch append.
 *
 * A flat number is honest here, unlike the span case that needed a resolver:
 * a grant command's payload is a handful of ids and never expands after
 * dequeue, so the drain's byte budget weighs it correctly.
 */
export const GRANT_COALESCE_MAX_BATCH = 50;

/**
 * The lane for one grant command, as a bucket of its aggregate id.
 *
 * The organization does not appear here on purpose: `buildGroupKey` already
 * prepends the command's tenant, so every lane this returns is per-organization
 * whether or not the string says so, and repeating it would only make the key
 * longer. `shardCount <= 1` collapses to a single lane per organization, which
 * is the "sharding off" spelling.
 */
export function grantCommandLane({
  aggregateId,
  shardCount = GRANT_SHARD_COUNT,
}: {
  aggregateId: string;
  shardCount?: number;
}): string {
  const lanes = clampShardCount(shardCount, MAX_GRANT_SHARD_COUNT);
  if (lanes <= 1) return "0";
  return String(shardIndexFor(aggregateId, lanes));
}
