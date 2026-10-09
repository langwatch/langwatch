import { describe, expect, it } from "vitest";

import {
  idpInitiatedLanding,
  isAllowableLandingTarget,
} from "../sso-idp-initiated-landing.rules.ts";

const appOrigin = "https://app.langwatch.example";
const defaultTarget = "/";
const landing = (relayState: string | undefined) =>
  idpInitiatedLanding({
    relayState,
    allowedTargets: ["/acme/messages"],
    appOrigin,
    defaultTarget,
  });

describe("isAllowableLandingTarget", () => {
  /** @scenario "A landing page must be a path on LangWatch itself" */
  it.each([
    "https://elsewhere.example",
    "//elsewhere.example/acme",
    "/\\elsewhere.example",
    "/acme%2Fmessages",
    "javascript:alert(1)",
    "acme/messages",
    "/acme#fragment",
    "/acme messages",
    `/${"a".repeat(2048)}`,
  ])("refuses %s", (entry) => {
    expect(isAllowableLandingTarget(entry)).toBe(false);
  });

  /** @scenario "A landing page must be a path on LangWatch itself" */
  it("accepts a path with a query on LangWatch itself", () => {
    expect(isAllowableLandingTarget("/acme/messages?tab=all")).toBe(true);
  });
});

describe("idpInitiatedLanding", () => {
  /** @scenario "A listed RelayState is where the person lands" */
  it("lands on the listed target the RelayState names", () => {
    expect(landing("/acme/messages")).toBe("/acme/messages");
  });

  /** @scenario "No RelayState lands on the default home" */
  it.each([undefined, ""])("lands on the default home for %j", (relayState) => {
    expect(landing(relayState)).toBe(defaultTarget);
  });

  /** @scenario "A full address on LangWatch's own origin lands on its listed path" */
  it("lands on the listed path of a full address on its own origin", () => {
    expect(landing(`${appOrigin}/acme/messages`)).toBe("/acme/messages");
  });

  /** @scenario "A RelayState not on the list lands on the default home" */
  it.each([
    "https://elsewhere.example/acme/messages",
    "//elsewhere.example/acme/messages",
    "/\\elsewhere.example/acme/messages",
    "/acme%2Fmessages",
    "%2Facme%2Fmessages",
    "/acme/messages/../../elsewhere",
    "/acme/messages-and-more",
    "/settings",
    "javascript:alert(1)",
    `https://user:secret@app.langwatch.example/acme/messages`,
    "http://app.langwatch.example/acme/messages",
  ])("lands %s on the default home", (relayState) => {
    expect(landing(relayState)).toBe(defaultTarget);
  });

  /** @scenario "A RelayState not on the list lands on the default home" */
  it("never lands on an unsafe entry even when it is listed", () => {
    const unsafe = "//elsewhere.example";

    expect(
      idpInitiatedLanding({
        relayState: unsafe,
        allowedTargets: [unsafe],
        appOrigin,
        defaultTarget,
      }),
    ).toBe(defaultTarget);
  });
});
