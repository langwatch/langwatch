// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The staff lists, per provider, and the one conversion they all feed.
 *
 * The distinction under test throughout: a provider that listed nobody and a
 * provider that would not answer are DIFFERENT outcomes. Everything else here
 * defends the join key, which is what decides whether a listed person lands on
 * the row their activity already created or becomes a second row beside it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("~/utils/ssrfProtection", () => ({
  ssrfSafeFetch: (...args: unknown[]) => fetchMock(...args),
}));

const { listAnthropicPeople, listOpenAiPeople } = await import(
  "../adminApiUsers"
);
const { listDatabricksPeople, scimUsersAsPeople } = await import(
  "../databricksScimUsers"
);
const { directoryUsersAsPeople, listMicrosoftPeople } = await import(
  "../microsoftDirectoryRead"
);
const { listingDay, peopleListed, peopleRefused, personListingEvents } =
  await import("../peopleListing");
const { DIRECTORY_REPORT_ACTION } = await import("../microsoftGraphDirectory");

/** A reply the ssrf-safe fetch helper would have produced. */
function reply({
  status = 200,
  body = {},
}: {
  status?: number;
  body?: unknown;
} = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("the three outcomes", () => {
  it("keeps an empty tenant and a refusal apart", () => {
    const empty = peopleListed([]);
    const refused = peopleRefused({ reason: "unauthorized", status: 403 });

    expect(empty.outcome).toBe("empty");
    expect(refused.outcome).toBe("refused");
  });

  it("carries no people to read on a refusal, so none can be counted as zero", () => {
    const refused = peopleRefused({ reason: "unauthorized", status: 403 });
    expect(refused).not.toHaveProperty("items");
  });
});

describe("turning listed people into directory events", () => {
  const person = {
    rawActorId: "user-1",
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    department: "Engineering",
  };

  it("marks them as a directory report, not activity", () => {
    const [event] = personListingEvents({
      people: [person],
      provider: "openai_admin",
      day: "2026-09-09",
    });

    // Activity dates mean "was active". A staff list is a statement about who
    // exists, so a listed person must not read as active today.
    expect(event?.action).toBe(DIRECTORY_REPORT_ACTION);
  });

  it("keys the actor on the provider's id, so erasure can suppress it", () => {
    const [event] = personListingEvents({
      people: [person],
      provider: "openai_admin",
      day: "2026-09-09",
    });

    expect(event?.actor).toBe("user-1");
    // Never the address: a tenant re-issues one, and keying on it would move a
    // person's whole history the day they change their name.
    expect(event?.actor).not.toBe("ada@example.com");
  });

  it("carries the name and the address where person discovery reads them", () => {
    const [event] = personListingEvents({
      people: [person],
      provider: "openai_admin",
      day: "2026-09-09",
    });

    expect(event?.extra).toMatchObject({
      displayName: "Ada Lovelace",
      mail: "ada@example.com",
      department: "Engineering",
    });
  });

  it("lands two listings on the same day onto one event", () => {
    const once = personListingEvents({
      people: [person],
      provider: "openai_admin",
      day: "2026-09-09",
    });
    const twice = personListingEvents({
      people: [person],
      provider: "openai_admin",
      day: "2026-09-09",
    });

    expect(once[0]?.source_event_id).toBe(twice[0]?.source_event_id);
  });

  it("drops a record with no identifier rather than emitting a blank actor", () => {
    const events = personListingEvents({
      people: [person, { ...person, rawActorId: "" }],
      provider: "openai_admin",
      day: "2026-09-09",
    });

    // A blank actor is a row the erasure check cannot suppress.
    expect(events).toHaveLength(1);
  });

  it("reports the day the instant falls in, in UTC", () => {
    expect(listingDay(new Date("2026-09-09T23:30:00Z"))).toBe("2026-09-09");
  });
});

describe("the Anthropic and OpenAI admin lists", () => {
  it("lists the members one page named", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        body: {
          data: [
            { id: "user-1", name: "Ada", email: "ada@example.com" },
            { id: "user-2", email: "grace@example.com" },
          ],
          has_more: false,
        },
      }),
    );

    const listing = await listOpenAiPeople({ apiKey: "sk-test" });

    expect(listing).toEqual({
      outcome: "listed",
      items: [
        {
          rawActorId: "user-1",
          displayName: "Ada",
          email: "ada@example.com",
          department: "",
        },
        {
          rawActorId: "user-2",
          displayName: "",
          email: "grace@example.com",
          department: "",
        },
      ],
    });
  });

  it("reads an organization with no members as empty, not refused", async () => {
    fetchMock.mockResolvedValueOnce(reply({ body: { data: [] } }));

    const listing = await listOpenAiPeople({ apiKey: "sk-test" });

    expect(listing).toEqual({ outcome: "empty", items: [] });
  });

  it("reads a 401 as an unauthorized refusal", async () => {
    fetchMock.mockResolvedValueOnce(reply({ status: 401 }));

    const listing = await listAnthropicPeople({ apiKey: "sk-test" });

    expect(listing).toEqual({
      outcome: "refused",
      refusal: { reason: "unauthorized", status: 401 },
    });
  });

  it("follows the cursor to the end of the list", async () => {
    fetchMock
      .mockResolvedValueOnce(
        reply({
          body: {
            data: [{ id: "user-1" }],
            has_more: true,
            last_id: "user-1",
          },
        }),
      )
      .mockResolvedValueOnce(
        reply({ body: { data: [{ id: "user-2" }], has_more: false } }),
      );

    const listing = await listAnthropicPeople({ apiKey: "sk-test" });

    expect(listing.outcome).toBe("listed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = String(fetchMock.mock.calls[1]?.[0]);
    expect(second).toContain("after_id=user-1");
  });

  it("stops rather than spinning when a cursor is served twice", async () => {
    fetchMock.mockResolvedValue(
      reply({
        body: { data: [{ id: "user-1" }], has_more: true, last_id: "user-1" },
      }),
    );

    const listing = await listAnthropicPeople({ apiKey: "sk-test" });

    expect(listing.outcome).toBe("listed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses a 2xx body that is not a page at all", async () => {
    fetchMock.mockResolvedValueOnce(reply({ body: "<html>sign in</html>" }));

    const listing = await listOpenAiPeople({ apiKey: "sk-test" });

    expect(listing).toEqual({
      outcome: "refused",
      refusal: { reason: "malformed_response", status: null },
    });
  });

  it("drops one unreadable member rather than losing the list", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        body: { data: [{ id: "user-1" }, { name: "no id" }], has_more: false },
      }),
    );

    const listing = await listOpenAiPeople({ apiKey: "sk-test" });

    expect(listing.outcome === "listed" && listing.items).toHaveLength(1);
  });

  it("never sends the admin key onward through a redirect", async () => {
    fetchMock.mockResolvedValueOnce(reply({ body: { data: [] } }));

    await listOpenAiPeople({ apiKey: "sk-test" });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      followRedirects: false,
    });
  });

  it("turns a transport failure into an unreachable refusal", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));

    const listing = await listOpenAiPeople({ apiKey: "sk-test" });

    expect(listing).toEqual({
      outcome: "refused",
      refusal: { reason: "unreachable", status: null },
    });
  });

  /**
   * A refusal is destined for a screen, and a fetch failure carries the URL it
   * failed on, which is where the key would be if it ever travelled.
   */
  it("never carries the admin key into the refusal", async () => {
    fetchMock.mockRejectedValueOnce(
      new Error("failed to fetch https://api.openai.com?key=sk-live-secret"),
    );

    const listing = await listOpenAiPeople({ apiKey: "sk-live-secret" });

    expect(JSON.stringify(listing)).not.toContain("sk-live-secret");
  });
});

describe("the Microsoft directory list", () => {
  it("keys people on the directory id, not the address", () => {
    const people = directoryUsersAsPeople([
      {
        id: "00000000-0000-4000-8000-000000000001",
        displayName: "Ada",
        mail: "ada@example.com",
        userPrincipalName: "ada@example.onmicrosoft.com",
        department: "Engineering",
      },
    ]);

    // The id a Dataverse transcript's author carries, so a listed person lands
    // on the row their conversations already created.
    expect(people[0]?.rawActorId).toBe("00000000-0000-4000-8000-000000000001");
    expect(people[0]?.email).toBe("ada@example.com");
  });

  it("falls back to the sign-in name when there is no mailbox", () => {
    const people = directoryUsersAsPeople([
      {
        id: "00000000-0000-4000-8000-000000000002",
        userPrincipalName: "grace@example.onmicrosoft.com",
      },
    ]);

    expect(people[0]?.email).toBe("grace@example.onmicrosoft.com");
  });

  it("reads a 403 as unauthorized rather than as an empty tenant", async () => {
    fetchMock.mockResolvedValueOnce(reply({ status: 403 }));

    const listing = await listMicrosoftPeople({ token: "graph-token" });

    expect(listing).toEqual({
      outcome: "refused",
      refusal: { reason: "unauthorized", status: 403 },
    });
  });

  it("refuses a reply whose next page points off Microsoft Graph", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        body: {
          value: [{ id: "00000000-0000-4000-8000-000000000003" }],
          "@odata.nextLink": "https://evil.example.com/users",
        },
      }),
    );

    const listing = await listMicrosoftPeople({ token: "graph-token" });

    // Following it would hand the Graph bearer token to whoever answers.
    expect(listing.outcome).toBe("refused");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads a tenant that lists nobody as empty", async () => {
    fetchMock.mockResolvedValueOnce(reply({ body: { value: [] } }));

    const listing = await listMicrosoftPeople({ token: "graph-token" });

    expect(listing).toEqual({ outcome: "empty", items: [] });
  });

  it("refuses when every row Graph served failed to parse", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ body: { value: [{ id: "not-a-uuid" }] } }),
    );

    const listing = await listMicrosoftPeople({ token: "graph-token" });

    // Recording "this tenant lists nobody" for "nobody could be read" would be
    // a false fact about the tenant.
    expect(listing).toEqual({
      outcome: "refused",
      refusal: { reason: "malformed_response", status: null },
    });
  });
});

describe("the Databricks SCIM list", () => {
  it("keys people on the login, matching what the puller writes as actor", () => {
    const people = scimUsersAsPeople([
      {
        id: "1234",
        userName: "ada@example.com",
        externalId: "ext-1",
        displayName: "Ada",
      },
    ]);

    // The Genie adapter writes `actor: identity.email || identity.key`, and
    // the email IS userName. Keying on the SCIM id would give every Databricks
    // human a second row with a name and no spend.
    expect(people[0]?.rawActorId).toBe("ada@example.com");
  });

  it("falls back to the external id, then to the SCIM id", () => {
    const people = scimUsersAsPeople([
      { id: "1234", externalId: "ext-1" },
      { id: "5678" },
    ]);

    expect(people[0]?.rawActorId).toBe("ext-1");
    expect(people[1]?.rawActorId).toBe("5678");
  });

  it("lists the users a page named", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        body: {
          Resources: [
            { id: "1", userName: "ada@example.com", displayName: "Ada" },
          ],
          totalResults: 1,
        },
      }),
    );

    const listing = await listDatabricksPeople({
      workspaceUrl: "https://dbc-1.cloud.databricks.com",
      token: "workspace-token",
    });

    expect(listing).toEqual({
      outcome: "listed",
      items: [
        {
          rawActorId: "ada@example.com",
          displayName: "Ada",
          email: "ada@example.com",
          department: "",
        },
      ],
    });
  });

  /**
   * `count` is a requested MAXIMUM under SCIM, so a workspace may serve fewer
   * rows than asked while more remain. Ending the walk on a short page drops
   * those silently, and the omission is invisible: the result is a listing
   * that looks like a complete directory.
   */
  it("keeps asking while the stated total says people remain", async () => {
    fetchMock
      .mockResolvedValueOnce(
        reply({
          body: {
            Resources: [{ id: "1", userName: "ada@example.com" }],
            totalResults: 2,
            itemsPerPage: 1,
            startIndex: 1,
          },
        }),
      )
      .mockResolvedValueOnce(
        reply({
          body: {
            Resources: [{ id: "2", userName: "grace@example.com" }],
            totalResults: 2,
            itemsPerPage: 1,
            startIndex: 2,
          },
        }),
      );

    const listing = await listDatabricksPeople({
      workspaceUrl: "https://dbc-1.cloud.databricks.com",
      token: "workspace-token",
    });

    expect(listing.outcome).toBe("listed");
    if (listing.outcome !== "listed") return;
    expect(listing.items.map((p) => p.rawActorId)).toEqual([
      "ada@example.com",
      "grace@example.com",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops on a page that named nobody, whatever total it claims", async () => {
    // Otherwise a workspace overstating its total would be asked from the same
    // index until the page budget ran out.
    fetchMock.mockResolvedValue(
      reply({ body: { Resources: [], totalResults: 500 } }),
    );

    const listing = await listDatabricksPeople({
      workspaceUrl: "https://dbc-1.cloud.databricks.com",
      token: "workspace-token",
    });

    expect(listing).toEqual({ outcome: "empty", items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * Bulk SCIM enumeration is unproven against a live workspace, and a
   * workspace that will not serve it answers 403. That has to reach an admin
   * as a refusal, never as a crash that burns three outbox attempts.
   */
  it("reads a workspace that refuses bulk listing as a refusal, not an error", async () => {
    fetchMock.mockResolvedValueOnce(reply({ status: 403 }));

    const listing = await listDatabricksPeople({
      workspaceUrl: "https://dbc-1.cloud.databricks.com",
      token: "workspace-token",
    });

    expect(listing).toEqual({
      outcome: "refused",
      refusal: { reason: "unauthorized", status: 403 },
    });
  });

  it("reads a legal SCIM page with no Resources member as empty", async () => {
    fetchMock.mockResolvedValueOnce(reply({ body: { totalResults: 0 } }));

    const listing = await listDatabricksPeople({
      workspaceUrl: "https://dbc-1.cloud.databricks.com",
      token: "workspace-token",
    });

    // SCIM permits omitting Resources when the result set is empty. Requiring
    // it would report "we could not ask" where "there are none" is the truth.
    expect(listing).toEqual({ outcome: "empty", items: [] });
  });

  it("refuses a body that is not a SCIM page at all", async () => {
    fetchMock.mockResolvedValueOnce(reply({ body: "<html>login</html>" }));

    const listing = await listDatabricksPeople({
      workspaceUrl: "https://dbc-1.cloud.databricks.com",
      token: "workspace-token",
    });

    expect(listing).toEqual({
      outcome: "refused",
      refusal: { reason: "malformed_response", status: null },
    });
  });

  it("stops after a short page rather than asking again", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ body: { Resources: [{ id: "1", userName: "a@b.com" }] } }),
    );

    await listDatabricksPeople({
      workspaceUrl: "https://dbc-1.cloud.databricks.com",
      token: "workspace-token",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never carries the workspace token into a refusal", async () => {
    fetchMock.mockRejectedValueOnce(
      new Error("failed to fetch https://dbc-1.example.com?t=sk-live-secret"),
    );

    const listing = await listDatabricksPeople({
      workspaceUrl: "https://dbc-1.cloud.databricks.com",
      token: "sk-live-secret",
    });

    expect(listing.outcome).toBe("refused");
    expect(JSON.stringify(listing)).not.toContain("sk-live-secret");
  });
});
