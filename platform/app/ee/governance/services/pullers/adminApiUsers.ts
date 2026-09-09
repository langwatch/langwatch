// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The staff lists behind the Anthropic and OpenAI admin APIs.
 *
 * ONE module for two providers, because they are one implementation. Both
 * expose a member list at an organization-scoped path, both page it with an
 * opaque id cursor and a `has_more` flag, and both answer with `{ id, name,
 * email }` per member. What differs is a base URL, an auth header and the name
 * of the cursor parameter, so those are arguments and the walk is written
 * once. Two files here would be two copies of "what does a 403 mean", drifting
 * apart the first time one of them is fixed.
 *
 * The reply is parsed leniently on purpose: only the id is required, and a row
 * that fails the row schema is DROPPED rather than thrown. One malformed
 * member must not cost the tenant the rest of its staff list, which is the
 * same posture `readDirectoryUserRows` takes for the same reason. A body that
 * is not a page at all is different: that is a proxy or a captive portal
 * answering, and it refuses the whole listing as `malformed_response`.
 */

import { z } from "zod";

import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import type { DiscoveredPersonRecord, PeopleListing } from "./peopleListing";
import { peopleListed, peopleRefused } from "./peopleListing";
import type { ListingRefusal } from "./providerListing";
import { refusalFromStatus, refusalFromThrown } from "./providerListing";

const LISTING_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;
/**
 * Enough for ten thousand members at the page size above. A cap rather than an
 * open loop because a provider that keeps saying `has_more` while serving the
 * same cursor would otherwise spin here until the lease expires.
 */
const MAX_PAGES = 100;

export const ANTHROPIC_USERS_URL =
  "https://api.anthropic.com/v1/organizations/users";
export const OPENAI_USERS_URL = "https://api.openai.com/v1/organization/users";

const ANTHROPIC_VERSION = "2023-06-01";

/**
 * One member. Only the id is required — both providers omit a name for an
 * invited member who has not accepted, and a member with an id and no name is
 * still somebody the organization lists.
 */
const memberSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  email: z.string().nullish(),
});

const memberPageSchema = z.object({
  data: z.array(z.unknown()),
  has_more: z.boolean().nullish(),
  last_id: z.string().nullish(),
});

/** One page, read row by row. */
function readMemberRows({ response }: { response: unknown }): {
  members: z.infer<typeof memberSchema>[];
  hasMore: boolean;
  lastId: string | null;
  malformed: boolean;
} {
  const page = memberPageSchema.safeParse(response);
  if (!page.success) {
    return { members: [], hasMore: false, lastId: null, malformed: true };
  }

  const members: z.infer<typeof memberSchema>[] = [];
  for (const raw of page.data.data) {
    const row = memberSchema.safeParse(raw);
    if (row.success) members.push(row.data);
  }

  const lastId = page.data.last_id ?? members[members.length - 1]?.id ?? null;
  return {
    members,
    hasMore: page.data.has_more === true,
    lastId,
    malformed: false,
  };
}

/**
 * An admin-API member as a person.
 *
 * `rawActorId` is the provider's member id, and for OpenAI that is exactly
 * what its cost rows carry (`actor: dimension(result.user_id)`), so a listed
 * member lands on the row their spend already created. Anthropic's cost rows
 * name nobody at all (`actor: ""`), so nothing there can collide either way —
 * the id is still the right key, because it is what a future Anthropic report
 * that does name people would carry.
 *
 * The address is a fact about them, never the key. Both providers re-issue
 * one, and keying on it would move a person's whole history on a rename.
 */
function membersAsPeople(
  members: z.infer<typeof memberSchema>[],
): DiscoveredPersonRecord[] {
  return members.map((member) => ({
    rawActorId: member.id,
    displayName: member.name?.trim() ?? "",
    email: member.email?.trim() ?? "",
    // Neither admin API carries a department. "" means the provider named
    // none, which is what the discovery path records as no department.
    department: "",
  }));
}

/** One page fetched and parsed, or the refusal that ended the walk. */
type MemberPageRead =
  | { ok: true; read: ReturnType<typeof readMemberRows> }
  | { ok: false; refusal: ListingRefusal };

async function fetchMemberPage(params: {
  baseUrl: string;
  headers: Record<string, string>;
  cursorParam: string;
  cursor: string | null;
  signal?: AbortSignal;
}): Promise<MemberPageRead> {
  const { baseUrl, headers, cursorParam, cursor, signal } = params;

  const url = new URL(baseUrl);
  url.searchParams.set("limit", String(PAGE_SIZE));
  if (cursor !== null) url.searchParams.set(cursorParam, cursor);

  const timeout = AbortSignal.timeout(LISTING_TIMEOUT_MS);
  const response = await ssrfSafeFetch(url.toString(), {
    method: "GET",
    headers: { ...headers, Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    // The headers carry the customer's admin key itself. The helper follows up
    // to ten redirects by default and re-sends headers to each host, so a
    // redirect would hand the key to wherever it points.
    followRedirects: false,
  });
  if (!response.ok) {
    return { ok: false, refusal: refusalFromStatus(response.status) };
  }

  const read = readMemberRows({ response: await response.json() });
  if (read.malformed) {
    return {
      ok: false,
      refusal: { reason: "malformed_response", status: null },
    };
  }
  return { ok: true, read };
}

/** Walks one admin API's member list to the end, or to a refusal. */
async function listAdminApiPeople(params: {
  baseUrl: string;
  headers: Record<string, string>;
  /** `after_id` for Anthropic, `after` for OpenAI. */
  cursorParam: string;
  signal?: AbortSignal;
}): Promise<PeopleListing> {
  const people: DiscoveredPersonRecord[] = [];
  let cursor: string | null = null;

  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await fetchMemberPage({ ...params, cursor });
      if (!result.ok) return peopleRefused(result.refusal);

      const { read } = result;
      people.push(...membersAsPeople(read.members));

      // A page that claims more but names no cursor cannot be followed, and a
      // provider re-serving a cursor it already served would spin this loop
      // until the lease expires. Both stop here, and both REPORT: the list so
      // far is made of members the provider actually named.
      if (!read.hasMore || read.lastId === null || read.lastId === cursor) {
        return peopleListed(people);
      }
      cursor = read.lastId;
    }
  } catch (error) {
    return peopleRefused(refusalFromThrown(error));
  }

  // Out of page budget with more to read. Reported rather than refused: a
  // partial staff list is still made of people who exist, and the widen-only
  // writes downstream mean the next press picks up what this one missed.
  return peopleListed(people);
}

/** Every member of an Anthropic organization one admin key can enumerate. */
export async function listAnthropicPeople(params: {
  apiKey: string;
  signal?: AbortSignal;
}): Promise<PeopleListing> {
  return await listAdminApiPeople({
    baseUrl: ANTHROPIC_USERS_URL,
    headers: {
      "x-api-key": params.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    cursorParam: "after_id",
    signal: params.signal,
  });
}

/** Every member of an OpenAI organization one admin key can enumerate. */
export async function listOpenAiPeople(params: {
  apiKey: string;
  signal?: AbortSignal;
}): Promise<PeopleListing> {
  return await listAdminApiPeople({
    baseUrl: OPENAI_USERS_URL,
    headers: { Authorization: `Bearer ${params.apiKey}` },
    cursorParam: "after",
    signal: params.signal,
  });
}
