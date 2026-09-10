// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * A Databricks workspace's whole user list, over SCIM.
 *
 * UNPROVEN, and written to stay safe while it is. Everything else this seam
 * calls has been exercised against a live tenant; bulk SCIM enumeration has
 * not. The puller reaches SCIM only one user at a time, by id, to put a name
 * on a query it already has, so nothing in the product has ever asked a
 * workspace for every user at once. Workspaces differ in whether that is
 * permitted at all: it depends on the token's entitlements and on whether the
 * workspace is account-managed, and a workspace may answer 403, or serve a
 * page shape the single-user read never showed us.
 *
 * So every way this can go wrong is a REFUSAL, never a throw and never a
 * crash. Nothing escapes `listDatabricksPeople`. That is the difference
 * between an unproven read that costs an admin a message saying the provider
 * would not answer, and one that fails an effect and burns three attempts
 * against a workspace that was never going to say yes.
 *
 * The reads it does are deliberately timid: a page cap, a strictly advancing
 * index, and a stop the moment the walk stops learning anything. A pagination
 * parameter this endpoint ignores would otherwise re-serve page one forever.
 *
 * The end of the collection is decided by the workspace's own `totalResults`
 * where it states one. A short page is only the fallback signal, because SCIM
 * treats `count` as a maximum rather than a promise, and a workspace serving
 * fewer rows than asked while holding more would otherwise have the rest
 * dropped without a trace.
 *
 * STOPPING IS NOT FINISHING, and every way this walk stops early is a refusal
 * rather than a short list. A walk that gives up at the page cap, or against a
 * workspace that stops advancing before the total it stated, has read a
 * FRACTION of the directory, and reporting that fraction as a listing puts it
 * on a screen as the whole staff. The number would look ordinary, every retry
 * would reproduce it, and nobody would have any way to tell. `walkStep` below
 * keeps the three endings apart; only the arithmetic one is a directory.
 */

import { z } from "zod";

import { GenieHttpError, genieGet } from "./genieSpaces";
import type { DiscoveredPersonRecord, PeopleListing } from "./peopleListing";
import { peopleListed, peopleRefused } from "./peopleListing";
import { refusalFromStatus, refusalFromThrown } from "./providerListing";

export const DATABRICKS_SCIM_USERS_PATH = "/api/2.0/preview/scim/v2/Users";

const LISTING_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;
/** Ten thousand users at the page size above. */
const MAX_PAGES = 100;

/**
 * One SCIM user, by the facts this listing records.
 *
 * Only the id is required. SCIM says a resource has one, and everything else
 * — including `userName` — is a field a given deployment may or may not fill.
 * `passthrough` matches the puller's own SCIM schema: a workspace returning a
 * wider row is normal, not an error.
 */
const scimUserSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    userName: z.string().nullish(),
    externalId: z.string().nullish(),
    displayName: z.string().nullish(),
    active: z.boolean().nullish(),
  })
  .passthrough();

/**
 * One SCIM page.
 *
 * `Resources` is OPTIONAL, and that is not laxness. SCIM permits a list
 * response with no `Resources` member at all when the result set is empty, and
 * a workspace that answers `{ totalResults: 0 }` is telling us it has no users
 * to show rather than answering badly. Requiring the key would turn that into
 * a malformed refusal and put "we could not ask" on a screen where "there are
 * none" is the truth.
 */
const scimPageSchema = z
  .object({
    Resources: z.array(z.unknown()).nullish(),
    totalResults: z.number().nullish(),
    startIndex: z.number().nullish(),
    itemsPerPage: z.number().nullish(),
  })
  .passthrough();

/**
 * A SCIM user as a person.
 *
 * The key precedence is `userName`, then `externalId`, then the SCIM id, and
 * it is copied from the puller rather than chosen: the Genie adapter writes
 * `actor: identity.email || identity.key`, where the email IS `userName` and
 * the key is `externalId || userName || the numeric id`. Reproducing that
 * exactly is what makes a listed person land on the row their queries already
 * created. Choosing the SCIM id instead — the obvious choice, and the wrong
 * one — would give every Databricks human a second row with a name and no
 * spend, beside their real row with spend and no name.
 */
export function scimUsersAsPeople(
  users: z.infer<typeof scimUserSchema>[],
): DiscoveredPersonRecord[] {
  return users.map((user) => {
    const userName = user.userName?.trim() ?? "";
    const externalId = user.externalId?.trim() ?? "";
    return {
      rawActorId: userName || externalId || user.id,
      displayName: user.displayName?.trim() ?? "",
      // `userName` is the login, which in Databricks is the address. When it
      // is absent there is no address to record, and "" says so.
      email: userName,
      // SCIM carries no department on the base user schema.
      department: "",
    };
  });
}

/** Reads one page, dropping rows that do not parse. */
function readScimPage({ response }: { response: unknown }): {
  users: z.infer<typeof scimUserSchema>[];
  returned: number;
  /**
   * What the workspace says the whole collection holds, when it says.
   *
   * Carried out of here rather than discarded because it is the only reliable
   * end-of-collection signal: `count` is a requested maximum and a SCIM server
   * may serve fewer rows than asked while more remain.
   */
  totalResults: number | null;
  isMalformed: boolean;
} {
  const page = scimPageSchema.safeParse(response);
  if (!page.success) {
    return { users: [], returned: 0, totalResults: null, isMalformed: true };
  }

  const raw = page.data.Resources ?? [];
  const users: z.infer<typeof scimUserSchema>[] = [];
  for (const row of raw) {
    const parsed = scimUserSchema.safeParse(row);
    // One unreadable service principal must not cost the workspace the rest
    // of its list, the same posture `readDirectoryUserRows` takes.
    if (parsed.success) users.push(parsed.data);
  }
  return {
    users,
    returned: raw.length,
    totalResults: page.data.totalResults ?? null,
    isMalformed: false,
  };
}

/**
 * Whether the walk has seen the whole collection.
 *
 * `totalResults` decides it when the workspace states one. `count` is a
 * requested MAXIMUM under SCIM, so a server may serve fewer rows than asked
 * while more remain, and ending on a short page drops those silently. The
 * short-page test survives only as the fallback for a workspace that omits the
 * total, which is the one case where it is the best signal available.
 */
function isCollectionExhausted(params: {
  returned: number;
  totalResults: number | null;
  /** The index the next request would ask from, already advanced. */
  nextIndex: number;
}): boolean {
  const { returned, totalResults, nextIndex } = params;
  if (totalResults === null) return returned < PAGE_SIZE;
  return nextIndex > totalResults;
}

/**
 * Appends the people this walk has not already recorded, and says how many.
 *
 * The count is the return value rather than the list length because it is what
 * the caller decides on: a page that added nobody means the walk is not
 * advancing, whatever the workspace claims its total to be.
 */
function appendUnseen({
  people,
  seenActorIds,
  candidates,
}: {
  people: DiscoveredPersonRecord[];
  seenActorIds: Set<string>;
  candidates: DiscoveredPersonRecord[];
}): number {
  let added = 0;
  for (const person of candidates) {
    if (seenActorIds.has(person.rawActorId)) continue;
    seenActorIds.add(person.rawActorId);
    people.push(person);
    added += 1;
  }
  return added;
}

/**
 * What this page told the walk to do next.
 *
 * Three answers rather than one boolean, because the three situations that
 * used to end the walk are not the same fact and must not reach a customer as
 * the same fact. Reaching the collection's end is a complete directory. A
 * workspace that stops advancing before the total it stated is an INCOMPLETE
 * one, and reporting that as complete hides however many users are behind the
 * wall while every retry repeats the same partial answer.
 *
 * `exhausted` is asked FIRST, so a final page that happens to repeat rows on a
 * collection already walked to its end reads as the end rather than a stall.
 *
 * `returned === 0` before the stated total is a STALL, not an end. The index
 * cannot advance past a page that served nothing, so the next request asks the
 * same question and is answered the same way. Where the workspace states no
 * total at all, `isCollectionExhausted` has already read a short page as the
 * end, which is the best signal available there.
 *
 * A page whose rows ALL failed to parse continues. `returned` counts the rows
 * the workspace served and the index advances by it, so a later page can still
 * be readable -- and `readScimPage` promises to skip individual bad rows
 * rather than let one unreadable service principal cost the rest of the list.
 * Ending here would break that promise one page at a time.
 *
 * Only a page that parsed rows and added NOBODY is a stall: every row it named
 * was already recorded, which is what a workspace ignoring `startIndex` looks
 * like. It re-serves the same first users forever while reporting a far larger
 * total, and the arithmetic below believes the total.
 */
type ScimWalkStep = "continue" | "exhausted" | "stalled";

function walkStep({
  returned,
  parsed,
  addedThisPage,
  totalResults,
  nextIndex,
}: {
  returned: number;
  parsed: number;
  addedThisPage: number;
  totalResults: number | null;
  nextIndex: number;
}): ScimWalkStep {
  if (isCollectionExhausted({ returned, totalResults, nextIndex })) {
    return "exhausted";
  }
  if (returned === 0) return "stalled";
  if (parsed === 0) return "continue";
  return addedThisPage === 0 ? "stalled" : "continue";
}

/**
 * What a walk that has stopped should report, or null while it is still going.
 *
 * The three endings in one place, so no caller can add a fourth way out of the
 * loop that reports a partial read as a directory. Only `exhausted` produces a
 * listing at all.
 *
 * An exhausted walk that parsed NOBODY out of rows the workspace did serve is
 * a refusal too. "This workspace employs nobody" and "nobody here could be
 * read" are different facts, and only the first belongs on a screen;
 * `listMicrosoftPeople` refuses the same case with the same reason. A walk
 * that was served no rows at all is a genuinely empty directory and stays one.
 */
function walkOutcome({
  step,
  people,
  rowsServed,
}: {
  step: ScimWalkStep;
  people: DiscoveredPersonRecord[];
  /** Rows the workspace served across the whole walk, readable or not. */
  rowsServed: number;
}): PeopleListing | null {
  if (step === "continue") return null;
  if (step === "stalled") {
    return peopleRefused({ reason: "pagination_stalled", status: null });
  }
  return rowsServed > 0 && people.length === 0
    ? peopleRefused({ reason: "malformed_response", status: null })
    : peopleListed(people);
}

/**
 * A thrown page read as the refusal it should reach an admin as.
 *
 * The status is the whole point of the first arm: a workspace that refuses
 * bulk SCIM answers 403, and that has to read as "your token may not
 * enumerate" rather than as a fault on our side.
 */
function refusalFromPageRead(error: unknown): PeopleListing {
  return peopleRefused(
    error instanceof GenieHttpError
      ? refusalFromStatus(error.status)
      : refusalFromThrown(error),
  );
}

/**
 * Every user a workspace token can enumerate.
 *
 * Never throws. See the note at the top of this file: this endpoint is
 * unproven for bulk use, so a workspace that will not serve it has to produce
 * a refusal an admin can read rather than an error an effect retries.
 */
export async function listDatabricksPeople(params: {
  workspaceUrl: string;
  token: string;
  signal?: AbortSignal;
}): Promise<PeopleListing> {
  const { workspaceUrl, token, signal } = params;

  const people: DiscoveredPersonRecord[] = [];
  // Every `rawActorId` already taken, because a page can repeat one.
  //
  // `startIndex` is a request, not a guarantee. A workspace that ignores it
  // answers every page with the same first hundred users while reporting a
  // total of a thousand, and the exhaustion check below believes the total: it
  // sees a full page and an index short of the end, so it asks again. With a
  // hundred-page budget that walk records the same hundred people up to a
  // hundred times, and the count the screen shows is the count of the
  // repetitions rather than of the workspace's staff.
  const seenActorIds = new Set<string>();
  let startIndex = 1;
  // Rows the workspace served, readable or not. Counted rather than parsed,
  // because it answers a question the people list cannot: a walk that ends
  // holding nobody out of rows that WERE served has not found an empty
  // directory, it has failed to read one.
  let rowsServed = 0;

  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await genieGet({
        workspaceUrl,
        token,
        path: DATABRICKS_SCIM_USERS_PATH,
        query: { startIndex: String(startIndex), count: String(PAGE_SIZE) },
        signal,
        timeoutMs: LISTING_TIMEOUT_MS,
      });

      const read = readScimPage({ response });
      if (read.isMalformed) {
        return peopleRefused({ reason: "malformed_response", status: null });
      }
      rowsServed += read.returned;
      const addedThisPage = appendUnseen({
        people,
        seenActorIds,
        candidates: scimUsersAsPeople(read.users),
      });

      startIndex += read.returned;

      const finished = walkOutcome({
        step: walkStep({
          returned: read.returned,
          parsed: read.users.length,
          addedThisPage,
          totalResults: read.totalResults,
          nextIndex: startIndex,
        }),
        people,
        rowsServed,
      });
      if (finished) return finished;
    }
  } catch (error) {
    return refusalFromPageRead(error);
  }

  // Out of page budget: the collection is longer than this walk will follow,
  // so the users it did read are a subset of the directory and cannot be shown
  // as the whole of it. Refused rather than reported for the reason
  // `listGenieAgents` refuses the same bound against the same workspace --
  // pressing Sync again reads the same pages and stops in the same place, so a
  // screen that claimed completeness here would go on claiming it.
  return peopleRefused({ reason: "too_many_pages", status: null });
}
