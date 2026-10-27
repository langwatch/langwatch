/**
 * The shell's join offer falls back to user's account-security offer, as main's
 * DashboardPageBody did. Public pages never draw the shell body at all.
 */

import { organizationWeb } from "@langwatch/organization-browser/declaration";
import { JoinOfferToken } from "@langwatch/organization-client";
import { userWeb } from "@langwatch/user-browser/declaration";
import { isValidElement, type ReactElement } from "react";
import { afterAll, describe, expect, it } from "vitest";

import { joinOffer } from "../navigation-host-capabilities";

// Importing the capabilities starts fetching their chunks, and this file ends in
// milliseconds. Wait for the same modules, so none lands after the environment is gone.
afterAll(async () => {
  const lend = organizationWeb.installation.lends.find(
    ({ token }) => token.key === JoinOfferToken.key,
  );
  await Promise.all([
    lend !== undefined && "load" in lend ? lend.load() : undefined,
    userWeb.installation.capabilities.secureAccountNudge.load(),
    userWeb.installation.capabilities.organizationMfaGate.load(),
  ]);
});

const takeoverFallback = (tree: unknown): unknown => {
  if (!isValidElement<{ children: ReactElement<{ fallback: unknown }> }>(tree)) {
    throw new Error("joinOffer drew no element");
  }
  return tree.props.children.props.fallback;
};

describe("joinOffer", () => {
  /** @scenario With no join offer to make, a password account is offered a passkey */
  it("falls back to the account-security offer on an app page", () => {
    const fallback = takeoverFallback(joinOffer({ currentOrganizationId: "org_1" }));

    expect(isValidElement(fallback)).toBe(true);
  });
});
