// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Reading a tenant's directory out of Microsoft Graph.
 *
 * `microsoftGraphDirectory.ts` stays pure — it decides what a reply MEANS.
 * This module does the talking, the same split `genieSpaces.ts` makes beside
 * its puller, and it exists because two callers now need the same walk: the
 * scheduled Copilot Studio pull, which reads the directory once a day, and the
 * people listing a person triggers from a screen.
 *
 * Neither LOGS from in here and neither is decided for. The walk hands back
 * what happened and each caller answers it in its own terms: the pull holds
 * the day, all or nothing, because it marks that day as read and half a
 * tenant recorded as the whole of it is permanent; the listing marks nothing,
 * so it can report a partial list and let the next press finish the job.
 *
 * Transport failures are NOT caught here. They propagate, so the pull's
 * existing outer catch keeps handling them exactly as it did, and the listing
 * maps them itself.
 */

import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import {
  DIRECTORY_USERS_FIRST_PAGE,
  type DirectoryUser,
  isMicrosoftGraphUrl,
  readDirectoryUserRows,
} from "./microsoftGraphDirectory";
import type { DiscoveredPersonRecord, PeopleListing } from "./peopleListing";
import { peopleListed, peopleRefused } from "./peopleListing";
import type { ListingRefusal } from "./providerListing";
import { refusalFromStatus, refusalFromThrown } from "./providerListing";

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * How many Graph pages a directory read may follow — at 999 rows a page,
 * about fifty thousand users.
 */
export const MAX_DIRECTORY_PAGES = 50;

/**
 * Why a directory walk stopped short.
 *
 * A cause rather than only a refusal, because the scheduled pull writes a
 * different log line for each of the three and those lines are what an
 * operator searches for. The refusal rides along for the caller that needs a
 * reason code instead.
 */
export type MicrosoftDirectoryFailure =
  | { cause: "http"; status: number; refusal: ListingRefusal }
  | { cause: "malformed"; refusal: ListingRefusal }
  | { cause: "foreign_next_link"; nextLink: string; refusal: ListingRefusal };

export type MicrosoftDirectoryRead =
  | {
      ok: true;
      users: DirectoryUser[];
      /** Rows Graph served that did not parse. Never fatal on its own. */
      unreadableRows: number;
      /** True when the page budget ran out with a next link still standing. */
      truncated: boolean;
    }
  | { ok: false; failure: MicrosoftDirectoryFailure };

/** One authenticated GET against Graph, parsed. */
async function readDirectoryPage(params: {
  url: string;
  token: string;
  signal?: AbortSignal;
}): Promise<ReturnType<typeof readDirectoryUserRows> | { status: number }> {
  const { url, token, signal } = params;

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await ssrfSafeFetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    // Carries a token minted from the customer's secret, so a redirect must
    // not hand it to whoever answers.
    followRedirects: false,
  });

  if (!response.ok) return { status: response.status };
  return readDirectoryUserRows({ response: await response.json() });
}

/**
 * The whole user list, across however many pages Graph serves it in.
 *
 * A next link that is not Microsoft Graph itself stops the walk rather than
 * being followed: it would otherwise be fetched carrying the Graph bearer
 * token, which is a credential handed to whoever the link names.
 */
export async function walkMicrosoftDirectory(params: {
  token: string;
  signal?: AbortSignal;
  maxPages?: number;
}): Promise<MicrosoftDirectoryRead> {
  const { token, signal } = params;
  const maxPages = params.maxPages ?? MAX_DIRECTORY_PAGES;

  const users: DirectoryUser[] = [];
  let unreadableRows = 0;
  let url: string = DIRECTORY_USERS_FIRST_PAGE;

  for (let page = 0; page < maxPages; page += 1) {
    const read = await readDirectoryPage({ url, token, signal });

    if ("status" in read) {
      return {
        ok: false,
        failure: {
          cause: "http",
          status: read.status,
          refusal: refusalFromStatus(read.status),
        },
      };
    }
    if (read.malformed) {
      return {
        ok: false,
        failure: {
          cause: "malformed",
          refusal: { reason: "malformed_response", status: null },
        },
      };
    }

    users.push(...read.users);
    unreadableRows += read.unreadableRows;

    if (read.nextLink === null) {
      return { ok: true, users, unreadableRows, truncated: false };
    }
    if (!isMicrosoftGraphUrl(read.nextLink)) {
      return {
        ok: false,
        failure: {
          cause: "foreign_next_link",
          nextLink: read.nextLink,
          // A reply pointing somewhere that is not the documented API is the
          // captive-portal case, whatever put it there.
          refusal: { reason: "malformed_response", status: null },
        },
      };
    }
    url = read.nextLink;
  }

  return { ok: true, users, unreadableRows, truncated: true };
}

/**
 * Directory users as people.
 *
 * `rawActorId` is the directory id, NOT the address, and that is the whole
 * reason a Microsoft person matches instead of duplicating: it is the
 * identifier the tenant's other rows use for the same human (a Dataverse
 * transcript's author IS this id), it survives a rename and a re-issued
 * address, and it is what an erasure of this provider's person suppresses.
 */
export function directoryUsersAsPeople(
  users: DirectoryUser[],
): DiscoveredPersonRecord[] {
  return users.map((user) => ({
    rawActorId: user.id,
    displayName: user.displayName?.trim() ?? "",
    // The address Graph carries, preferring the mailbox over the sign-in name
    // the same way the directory events already do.
    email: user.mail?.trim() ?? user.userPrincipalName?.trim() ?? "",
    // Trimmed, matching the department sync: a field holding only spaces is a
    // tenant leaving it blank, not a department named " ".
    department: user.department?.trim() ?? "",
  }));
}

/**
 * Every person a tenant's directory lists.
 *
 * A truncated walk is REPORTED rather than refused, unlike the scheduled read.
 * Nothing here marks a day as done, so a partial list costs nothing beyond
 * being partial, and the people in it are people who exist.
 */
export async function listMicrosoftPeople(params: {
  token: string;
  signal?: AbortSignal;
}): Promise<PeopleListing> {
  try {
    const read = await walkMicrosoftDirectory(params);
    if (!read.ok) return peopleRefused(read.failure.refusal);

    // Every row Graph served failed to parse. Reporting "this tenant lists
    // nobody" for "nobody could be read" would be a false fact about the
    // tenant, so it refuses instead.
    if (read.users.length === 0 && read.unreadableRows > 0) {
      return peopleRefused({ reason: "malformed_response", status: null });
    }
    return peopleListed(directoryUsersAsPeople(read.users));
  } catch (error) {
    return peopleRefused(refusalFromThrown(error));
  }
}
