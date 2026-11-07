/** @see specs/identity/idp-refused-sign-in.feature */
import { describe, expect, it } from "vitest";

import {
  isSamlAssertionConsumerPost,
  samlResponseOutcomeOf,
} from "../saml-response-status.rules.ts";

const STATUS = "urn:oasis:names:tc:SAML:2.0:status";

function formWith(xml: string): string {
  return new URLSearchParams({
    SAMLResponse: Buffer.from(xml).toString("base64"),
    RelayState: "r",
  }).toString();
}

function response(top: string): string {
  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"><samlp:Status><samlp:StatusCode Value="${top}"><samlp:StatusCode Value="${STATUS}:RequestDenied"/></samlp:StatusCode></samlp:Status></samlp:Response>`;
}

describe("samlResponseOutcomeOf", () => {
  /** @scenario "A SAML Response's status is read from its top-level StatusCode only" */
  it("reads a non-Success top-level status as refused", () => {
    expect(samlResponseOutcomeOf({ formBody: formWith(response(`${STATUS}:Responder`)) })).toBe(
      "refused",
    );
    expect(samlResponseOutcomeOf({ formBody: formWith(response(`${STATUS}:Requester`)) })).toBe(
      "refused",
    );
  });

  /** @scenario "A SAML Response's status is read from its top-level StatusCode only" */
  it.each([
    ["a Success status", formWith(response(`${STATUS}:Success`))],
    ["no SAMLResponse", "RelayState=r"],
    ["a body that is not base64 XML", "SAMLResponse=%%%"],
    ["an oversized body", `SAMLResponse=${"A".repeat(600 * 1024)}`],
  ])("reads %s as not refused", (_label, formBody) => {
    expect(samlResponseOutcomeOf({ formBody })).toBe("other");
  });
});

describe("isSamlAssertionConsumerPost", () => {
  it("matches only a POST to one connection's assertion consumer", () => {
    expect(
      isSamlAssertionConsumerPost({
        pathname: "/api/auth/sso/saml2/sp/acs/ssoc_1",
        method: "POST",
      }),
    ).toBe(true);
    expect(
      isSamlAssertionConsumerPost({ pathname: "/api/auth/sso/saml2/sp/acs/ssoc_1", method: "GET" }),
    ).toBe(false);
    expect(
      isSamlAssertionConsumerPost({ pathname: "/api/auth/sso/callback/ssoc_1", method: "POST" }),
    ).toBe(false);
  });
});
