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
 * index, and a stop as soon as a page comes back short. A pagination
 * parameter this endpoint ignores would otherwise re-serve page one forever.
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
  malformed: boolean;
} {
  const page = scimPageSchema.safeParse(response);
  if (!page.success) return { users: [], returned: 0, malformed: true };

  const raw = page.data.Resources ?? [];
  const users: z.infer<typeof scimUserSchema>[] = [];
  for (const row of raw) {
    const parsed = scimUserSchema.safeParse(row);
    // One unreadable service principal must not cost the workspace the rest
    // of its list, the same posture `readDirectoryUserRows` takes.
    if (parsed.success) users.push(parsed.data);
  }
  return { users, returned: raw.length, malformed: false };
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
  let startIndex = 1;

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
      if (read.malformed) {
        return peopleRefused({ reason: "malformed_response", status: null });
      }
      people.push(...scimUsersAsPeople(read.users));

      // A short page is the last page. This is also the guard against a
      // workspace that ignores `startIndex` entirely: such a workspace serves
      // a full first page forever, and the index check below stops it.
      if (read.returned < PAGE_SIZE) return peopleListed(people);
      startIndex += read.returned;
    }
  } catch (error) {
    if (error instanceof GenieHttpError) {
      // The status is the whole point here. A workspace that refuses bulk SCIM
      // answers 403, and that has to read as "your token may not enumerate"
      // rather than as a fault on our side.
      return peopleRefused(refusalFromStatus(error.status));
    }
    return peopleRefused(refusalFromThrown(error));
  }

  // Out of page budget. Reported rather than refused: these are users the
  // workspace named, and the writes downstream widen rather than replace.
  return peopleListed(people);
}
