// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * One directory walk, two callers: the scheduled Copilot Studio pull holds the
 * day on any failure, the people listing reports a partial list. Neither logs
 * from in here; the walk hands back what happened.
 */

import type { GovernanceHttpClient } from "../../app/governance.members.ts";
import {
  DIRECTORY_USERS_FIRST_PAGE,
  type DirectoryUser,
  isMicrosoftGraphUrl,
  readDirectoryUserRows,
} from "../../rules/microsoft-graph-directory.rules.ts";
import type { DiscoveredPersonRecord, PeopleListing } from "../../rules/people-listing.rules.ts";
import { peopleListed, peopleRefused } from "../../rules/people-listing.rules.ts";
import { refusalFromStatus, refusalFromThrown } from "../../rules/provider-listing.rules.ts";
import type {
  MicrosoftDirectoryChannel,
  MicrosoftDirectoryRead,
} from "../microsoft-directory.channel.ts";

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * How many Graph pages a directory read may follow — at 999 rows a page,
 * about fifty thousand users.
 */
const MAX_DIRECTORY_PAGES = 50;

/** One authenticated GET against Graph, parsed. */
async function readDirectoryPage(params: {
  http: GovernanceHttpClient;
  url: string;
  token: string;
  signal?: AbortSignal;
}): Promise<ReturnType<typeof readDirectoryUserRows> | { status: number }> {
  const { http, url, token, signal } = params;

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await http.fetch(url, {
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
async function walkMicrosoftDirectory(params: {
  http: GovernanceHttpClient;
  token: string;
  signal?: AbortSignal;
}): Promise<MicrosoftDirectoryRead> {
  const { http, token, signal } = params;

  const users: DirectoryUser[] = [];
  let unreadableRows = 0;
  let url: string = DIRECTORY_USERS_FIRST_PAGE;

  for (let page = 0; page < MAX_DIRECTORY_PAGES; page += 1) {
    const read = await readDirectoryPage({ http, url, token, signal });

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
export function directoryUsersAsPeople(users: DirectoryUser[]): DiscoveredPersonRecord[] {
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

/** The directory, over the process's HTTP client. */
export class HttpMicrosoftDirectoryChannel implements MicrosoftDirectoryChannel {
  private constructor(private readonly http: GovernanceHttpClient) {}

  static create({ http }: { http: GovernanceHttpClient }): HttpMicrosoftDirectoryChannel {
    return new HttpMicrosoftDirectoryChannel(http);
  }

  /** The whole user list, or why the walk stopped. Transport failures propagate. */
  async readDirectory(params: {
    token: string;
    signal?: AbortSignal;
  }): Promise<MicrosoftDirectoryRead> {
    return walkMicrosoftDirectory({ http: this.http, ...params });
  }

  /**
   * Every person a tenant's directory lists. A truncated walk is REPORTED
   * rather than refused: nothing here marks a day as done, and the people in a
   * partial list are people who exist.
   */
  async listPeople(params: { token: string; signal?: AbortSignal }): Promise<PeopleListing> {
    try {
      const read = await this.readDirectory(params);
      if (!read.ok) return peopleRefused(read.failure.refusal);

      // Every row Graph served failed to parse: "nobody could be read" is not "this tenant lists nobody".
      if (read.users.length === 0 && read.unreadableRows > 0) {
        return peopleRefused({ reason: "malformed_response", status: null });
      }
      return peopleListed(directoryUsersAsPeople(read.users));
    } catch (error) {
      return peopleRefused(refusalFromThrown(error));
    }
  }
}
