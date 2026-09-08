/**
 * The Costs page's own half of the sample-mode decision: which of its reads
 * count as "the organization has real cost data".
 *
 * The decision itself — sample data fills an empty screen, an explicit choice
 * wins, an unanswered read is not an empty one — is the section-wide rule in
 * `~/components/governance/sample`. Only what is specific to this page lives
 * here, which is the headline cost summary: the other reads are plain arrays
 * and need no translation.
 */
import type { GovernanceCostSummaryDto } from "@ee/governance/services/governanceCost.service";

/**
 * What the sample decision reads off the headline summary — derived from the
 * DTO rather than transcribed, so a renamed field or a restructured seats
 * union breaks this file at compile time instead of silently never counting.
 */
export type SummaryForSampleDecision = Pick<
  GovernanceCostSummaryDto,
  "unavailableReason" | "billed" | "gateway" | "seats"
>;

/**
 * The lanes' headline summary, translated into the pseudo-read shape the
 * resolver takes. The lanes are real data too: an organization whose bill has
 * been pulled but whose gateway has served nothing would otherwise count as
 * empty, and the invented panels would render beside a real headline figure —
 * the exact confusion the sample rule exists to prevent.
 *
 * A lane counts when it holds a figure OR reported cells it could not price:
 * a withheld total is still a real bill. `unavailable` is a structural empty,
 * so it answers as such rather than staying unknown forever.
 */
/**
 * Whether a failed read was the server REFUSING rather than breaking.
 *
 * The distinction the Costs page got wrong, and the reason a customer who had
 * configured nothing was met by "Something went wrong reading your cost
 * figures". Nothing had gone wrong: the plan gate declined the read
 * (`requireEnterprisePlan` answers FORBIDDEN), or the viewer lacked the grant.
 * Both are account states with an owner and an action; neither is an outage,
 * and blaming the product for one sends a customer to support over a screen
 * behaving exactly as designed.
 *
 * It also decides the sample default. A refusal is a SETTLED answer — this
 * screen has nothing on it and will keep having nothing until somebody changes
 * the account — so it resolves the sample decision to "absent" and the invented
 * panels fill the screen, which is the case they exist for. A genuine failure
 * stays unsettled: we do not know what is behind it, so the page says so and
 * leaves the reader to ask for samples.
 *
 * Read off tRPC's own `data.code` rather than the message, because the message
 * is copy and will change.
 */
export function isRefusedRead(
  error: { data?: { code?: string | null } | null } | null | undefined,
): boolean {
  const code = error?.data?.code;
  return code === "FORBIDDEN" || code === "UNAUTHORIZED";
}

/**
 * What a read contributes to the sample decision once its refusal is taken
 * into account: an answer of nothing, rather than a silence.
 */
export function refusedAsEmpty<T extends { length: number }>(
  read: T | null,
  error: { data?: { code?: string | null } | null } | null | undefined,
): T | { length: number } | null {
  return declinedAsEmpty(read, isRefusedRead(error));
}

/**
 * The same rule for a caller that has already worked out it was refused —
 * several reads behind one gate share a single verdict rather than each
 * carrying its own error object.
 */
export function declinedAsEmpty<T extends { length: number }>(
  read: T | null,
  refused: boolean,
): T | { length: number } | null {
  if (read !== null) return read;
  return refused ? { length: 0 } : null;
}

export function summaryAsRead(
  data: SummaryForSampleDecision | undefined,
): { length: number } | null {
  if (data === undefined) return null;
  if (data.unavailableReason !== null) return { length: 0 };
  const laneReported = (lane: {
    amountUsd: number | null;
    cellsWithoutAmount: number;
  }) => lane.amountUsd !== null || lane.cellsWithoutAmount > 0;
  const reported =
    (laneReported(data.billed) ? 1 : 0) +
    (laneReported(data.gateway) ? 1 : 0) +
    (data.seats.status === "reported" && data.seats.pools.length > 0 ? 1 : 0);
  return { length: reported };
}
