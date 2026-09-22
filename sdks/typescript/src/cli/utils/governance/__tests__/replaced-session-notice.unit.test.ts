/**
 * A login overwrites the session on this machine in place. Logging in as a
 * second account left every command answering from the first account's
 * organization, with nothing on screen saying the account had changed.
 */
import { describe, expect, it } from "vitest";

import { replacedSessionNotice } from "../login-flow";

const ACME = {
  user: { email: "someone@acme.example" },
  organization: { id: "org_acme", slug: "acme", name: "ACME" },
};

const OTHER = {
  user: { email: "someone+test@acme.example" },
  organization: { id: "org_test", slug: "test-org", name: "Test Org" },
};

describe("given the machine already holds a login", () => {
  /** @scenario "Logging in as another organization says whose login it replaced" */
  it("names both sides when the organization changes", () => {
    const notice = replacedSessionNotice(ACME, OTHER);

    expect(notice).toContain("someone@acme.example in ACME");
    expect(notice).toContain("someone+test@acme.example in Test Org");
  });

  it("says the previous login is signed out, not merely changed", () => {
    expect(replacedSessionNotice(ACME, OTHER)).toContain("signed out");
  });

  /** @scenario "Logging in again as the same organization says nothing extra" */
  it("says nothing when the same organization logs in again", () => {
    expect(
      replacedSessionNotice(ACME, {
        user: { email: "someone@acme.example" },
        organization: { id: "org_acme", slug: "acme", name: "ACME" },
      }),
    ).toBeUndefined();
  });

  it("says nothing for a different account inside the same organization", () => {
    expect(
      replacedSessionNotice(ACME, {
        user: { email: "colleague@acme.example" },
        organization: { id: "org_acme", slug: "acme", name: "ACME" },
      }),
    ).toBeUndefined();
  });
});

describe("given the machine holds no login yet", () => {
  it("says nothing, because nothing is being replaced", () => {
    expect(replacedSessionNotice({}, OTHER)).toBeUndefined();
  });
});

describe("given a login stored before organization names were recorded", () => {
  it("falls back to the slug rather than printing a blank", () => {
    const notice = replacedSessionNotice(
      { user: { email: "someone@acme.example" }, organization: { id: "org_acme", slug: "acme" } },
      OTHER,
    );

    expect(notice).toContain("someone@acme.example in acme");
  });
});
