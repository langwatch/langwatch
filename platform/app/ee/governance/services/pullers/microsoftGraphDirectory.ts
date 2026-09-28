// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Who exists in the tenant, read from its directory.
 *
 * Conversations know people only as directory ids, and the licence list knows
 * only counts. The directory is the one source that knows what an id is
 * called, what address it answers to, and which department the tenant filed
 * it under — the three facts the identity tables and the department screen
 * need and no activity row carries. Same Microsoft Graph audience as the
 * licence read, one more consent (`User.Read.All`).
 *
 * Pure, exactly as `microsoftGraphSeats.ts` is pure: no I/O, no clock, no
 * fetch. The caller does the talking and hands the reply here, so every rule
 * below is decided against a captured reply in a unit test.
 *
 * Unlike `/subscribedSkus`, `/users` DOES page: the reply carries an
 * `@odata.nextLink` until the list is done, and the caller follows it. The
 * reader hands the link back beside the rows rather than hiding the loop
 * here, keeping this module pure.
 *
 * The day-cursor contract — read once a day, hold a refused day, give up
 * after a week so an unconsented tenant costs one request a day — is the
 * licence read's contract verbatim, and it is imported from there rather than
 * restated: two copies of "what does giving up do" is how the two reads drift
 * into answering it differently.
 *
 * Spec: specs/governance/governance-people-discovery.feature
 */

import { z } from "zod";
import { nextSeatsCursor, seatsReadIsDue } from "./microsoftGraphSeats";
import type { NormalizedPullEvent } from "./pullerAdapter";

/** The verb these events carry, so a reader can tell them from a conversation. */
export const DIRECTORY_REPORT_ACTION = "directory_report" as const;

const MICROSOFT_GRAPH_HOST = "graph.microsoft.com";

/**
 * Whether a URL is Microsoft Graph itself — the gate a next-page link passes
 * before it is followed carrying the Graph bearer token. The same four
 * comparisons `isAzureResourceManagerUrl` makes, for the same reasons: parsed
 * rather than prefix-compared, https only, no credentials in the authority,
 * no port games.
 */
export function isMicrosoftGraphUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.port !== "") return false;
  return url.hostname === MICROSOFT_GRAPH_HOST;
}

/**
 * The first page of the tenant's user list. `$select` keeps the reply to the
 * facts recorded below — Graph returns a much wider row unasked — and `$top`
 * at its documented maximum keeps the page count down on large tenants.
 */
export const DIRECTORY_USERS_FIRST_PAGE =
  "https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,userPrincipalName,department,accountEnabled&$top=999";

/**
 * One user row, by the facts this read records. Only the id is required:
 * Graph omits any selected field the row does not carry (`mail` is routinely
 * absent on unlicensed accounts), and a row missing everything but its id is
 * still a person the tenant lists.
 */
const directoryUserSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().nullish(),
  mail: z.string().nullish(),
  userPrincipalName: z.string().nullish(),
  department: z.string().nullish(),
  accountEnabled: z.boolean().nullish(),
});

export type DirectoryUser = z.infer<typeof directoryUserSchema>;

const directoryPageSchema = z.object({
  value: z.array(z.unknown()),
  "@odata.nextLink": z.string().optional(),
});

/**
 * Reads one page of the user list, row by row.
 *
 * Same posture as `readSubscribedSkuRows`: a body that is not a page at all
 * is `malformed` (the caller holds the day rather than recording an empty
 * tenant), and a row that fails the row schema is counted rather than thrown
 * — one unreadable guest account must not cost the tenant the rest of the
 * directory.
 */
export function readDirectoryUserRows({ response }: { response: unknown }): {
  users: DirectoryUser[];
  unreadableRows: number;
  nextLink: string | null;
  malformed: boolean;
} {
  const page = directoryPageSchema.safeParse(response);
  if (!page.success) {
    return { users: [], unreadableRows: 0, nextLink: null, malformed: true };
  }

  const users: DirectoryUser[] = [];
  let unreadableRows = 0;
  for (const raw of page.data.value) {
    const row = directoryUserSchema.safeParse(raw);
    if (row.success) users.push(row.data);
    else unreadableRows += 1;
  }

  return {
    users,
    unreadableRows,
    nextLink: page.data["@odata.nextLink"] ?? null,
    malformed: false,
  };
}

/**
 * The users a read found, as the events the run hands back.
 *
 * The identity is the person and the day, never the fields — two reads of the
 * same day land ON each other, exactly as seat events do.
 *
 * `actor` is the directory id, not the address. It is the identifier the
 * tenant's other rows use for the same human (a Dataverse transcript's author
 * IS this id), it survives a rename and a re-issued address, and it is what
 * an erasure of this provider's person suppresses — which is how a directory
 * row naming an erased person is dropped by the same do-not-reimport check
 * every pulled event passes through, with no directory-specific carve-out to
 * maintain.
 *
 * The address and the department travel in `extra`: they are facts ABOUT the
 * actor, and putting the address in `actor` would key suppression on the one
 * field the tenant re-issues.
 */
export function microsoftDirectoryEvents({
  users,
  day,
}: {
  users: DirectoryUser[];
  /** The calendar day being reported on, `YYYY-MM-DD` in UTC. */
  day: string;
}): NormalizedPullEvent[] {
  return users.map((user) => ({
    source_event_id: `msgraph_directory:${user.id}:${day}`,
    // The day the listing belongs to, not the instant it was read.
    event_timestamp: `${day}T00:00:00.000Z`,
    actor: user.id,
    action: DIRECTORY_REPORT_ACTION,
    target: user.department ?? "",
    cost_usd: "0",
    tokens_input: 0,
    tokens_output: 0,
    raw_payload: JSON.stringify(user),
    extra: {
      directoryId: user.id,
      displayName: user.displayName ?? "",
      mail: user.mail ?? "",
      userPrincipalName: user.userPrincipalName ?? "",
      department: user.department ?? "",
      // A boolean, not a string, for the same reason seat facts are native
      // types: the OCSF row serialises it as JSON and keeps it.
      accountEnabled: user.accountEnabled ?? true,
    },
  }));
}

/**
 * Whether this run should read the directory at all. The licence read's
 * once-a-day rule, unchanged: a directory changes on people-time, and a
 * two-minute cadence would ask Graph hundreds of times a day for the same
 * answer.
 */
export function directoryReadIsDue(params: {
  nowMs: number;
  reportedThroughDay: string | null;
}): boolean {
  return seatsReadIsDue(params);
}

/**
 * Where the directory read stands after a run — reported, held, or given up.
 * The licence read's contract verbatim, including keeping the hold instant
 * through a give-up so an unconsented tenant costs one request a day forever
 * rather than a fresh week of asking.
 */
export function nextDirectoryCursor(params: {
  nowMs: number;
  previous: { reportedThroughDay: string | null; heldSinceMs: number | null };
  outcome: "reported" | "held";
}): { reportedThroughDay: string | null; heldSinceMs: number | null } {
  return nextSeatsCursor(params);
}
