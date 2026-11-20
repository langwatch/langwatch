/** Spec: modules/notification/specs/customer-io-transactional.feature */
import { mailTemplates } from "@langwatch/mail";
import { describe, expect, it } from "vitest";

import { CUSTOMER_IO_ROUTES } from "../customer-io-routing.rules.ts";

/** Written out here, not read from the table: the list is the agreed scope, not a default. */
const AGREED = [
  "invite-re-request",
  "join-request-arrived",
  "join-request-reminder",
  "join-request-approved",
  "join-request-rejected",
  "join-request-expired",
  "domain-auto-joined",
  "seat-request",
  "usage-limit",
  "payment-recovery",
  "budget-increase-request",
  "automation-limit",
  "trigger-digest",
  "monitor-auto-paused",
];

const SECURITY = [
  "sign-up-verification",
  "reset-password",
  "address-confirmation",
  "invite",
  "organization-mfa-requirement",
  "sso-domain-proof-wavering",
  "sso-domain-proof-lapsed",
  "idp-refused-sign-in",
  "license",
  "connected-statement",
  "upgrade-alert",
  "platform-operator-change",
];

describe("the Customer.io routing list", () => {
  /** @scenario "The routing list holds the agreed product messages and no security mail" */
  it("holds exactly the fourteen agreed template ids, each falling back to the own mailer", () => {
    expect(Object.keys(CUSTOMER_IO_ROUTES).toSorted()).toEqual(AGREED.toSorted());
    for (const route of Object.values(CUSTOMER_IO_ROUTES)) {
      expect(route).toEqual({ fallback: "own-mailer" });
    }
  });

  /** @scenario "The routing list holds the agreed product messages and no security mail" */
  it("holds no security message, each of which is a template the app sends", () => {
    const sent = new Set(mailTemplates.map((template) => template.id));
    for (const id of SECURITY) {
      expect(sent.has(id), `${id} is a template`).toBe(true);
      expect(Object.hasOwn(CUSTOMER_IO_ROUTES, id), `${id} is not routed`).toBe(false);
    }
  });

  /** @scenario "The routing list holds the agreed product messages and no security mail" */
  it("names only templates the app sends", () => {
    const sent = new Set(mailTemplates.map((template) => template.id));
    expect(Object.keys(CUSTOMER_IO_ROUTES).filter((id) => !sent.has(id))).toEqual([]);
  });
});
