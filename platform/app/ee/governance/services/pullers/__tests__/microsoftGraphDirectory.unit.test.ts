// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The pure half of the directory read: row reading, event shaping, and the
 * host gate a next-page link passes before it is followed with a token.
 *
 * Spec: specs/governance/governance-people-discovery.feature
 */

import { describe, expect, it } from "vitest";

import {
  DIRECTORY_REPORT_ACTION,
  isMicrosoftGraphUrl,
  microsoftDirectoryEvents,
  readDirectoryUserRows,
} from "../microsoftGraphDirectory";

const USER_ID = "f6481ec4-e30f-4bf3-954f-2a8f29bb1c4a";

const graphUser = (over: Record<string, unknown> = {}) => ({
  id: USER_ID,
  displayName: "Maria Silva",
  mail: "m.silva@acme.test",
  userPrincipalName: "m.silva@acme.test",
  department: "Engineering",
  accountEnabled: true,
  ...over,
});

describe("reading a directory page", () => {
  it("reads the rows and hands back the next link beside them", () => {
    const read = readDirectoryUserRows({
      response: {
        value: [graphUser()],
        "@odata.nextLink":
          "https://graph.microsoft.com/v1.0/users?$skiptoken=x",
      },
    });

    expect(read.malformed).toBe(false);
    expect(read.users).toHaveLength(1);
    expect(read.nextLink).toContain("$skiptoken");
  });

  it("counts an unreadable row rather than dropping the page", () => {
    const read = readDirectoryUserRows({
      response: { value: [graphUser(), { id: "not-a-guid" }] },
    });

    expect(read.users).toHaveLength(1);
    expect(read.unreadableRows).toBe(1);
  });

  it("keeps a row that carries nothing but its id — Graph omits absent fields", () => {
    const read = readDirectoryUserRows({
      response: { value: [{ id: USER_ID }] },
    });

    expect(read.users).toHaveLength(1);
    expect(read.unreadableRows).toBe(0);
  });

  it("calls a body that is not a page malformed, not an empty tenant", () => {
    const read = readDirectoryUserRows({ response: { error: "oops" } });

    expect(read.malformed).toBe(true);
    expect(read.users).toHaveLength(0);
  });
});

describe("shaping directory events", () => {
  it("keys the event on the person and the day, with the directory id as actor", () => {
    const [event] = microsoftDirectoryEvents({
      users: [graphUser()],
      day: "2026-09-03",
    });

    expect(event).toMatchObject({
      source_event_id: `msgraph_directory:${USER_ID}:2026-09-03`,
      event_timestamp: "2026-09-03T00:00:00.000Z",
      // The id, never the address: it is what the tenant's other rows call
      // the same human, and what an erasure of this provider suppresses.
      actor: USER_ID,
      action: DIRECTORY_REPORT_ACTION,
      cost_usd: "0",
    });
    expect(event?.extra).toMatchObject({
      displayName: "Maria Silva",
      mail: "m.silva@acme.test",
      department: "Engineering",
      accountEnabled: true,
    });
  });

  it("shapes absent fields as empty strings, never as the word undefined", () => {
    const [event] = microsoftDirectoryEvents({
      users: [
        {
          id: USER_ID,
          displayName: null,
          mail: null,
          userPrincipalName: null,
          department: null,
          accountEnabled: null,
        },
      ],
      day: "2026-09-03",
    });

    expect(event?.extra).toMatchObject({
      displayName: "",
      mail: "",
      department: "",
    });
  });
});

describe("the next-page host gate", () => {
  it("accepts only https Microsoft Graph with a clean authority", () => {
    expect(
      isMicrosoftGraphUrl(
        "https://graph.microsoft.com/v1.0/users?$skiptoken=x",
      ),
    ).toBe(true);
    expect(isMicrosoftGraphUrl("http://graph.microsoft.com/v1.0/users")).toBe(
      false,
    );
    expect(isMicrosoftGraphUrl("https://evil.test/v1.0/users")).toBe(false);
    expect(
      isMicrosoftGraphUrl("https://graph.microsoft.com.evil.test/users"),
    ).toBe(false);
    expect(
      isMicrosoftGraphUrl("https://user:pass@graph.microsoft.com/users"),
    ).toBe(false);
    expect(isMicrosoftGraphUrl("https://graph.microsoft.com:8443/users")).toBe(
      false,
    );
    expect(isMicrosoftGraphUrl("not a url")).toBe(false);
  });
});
