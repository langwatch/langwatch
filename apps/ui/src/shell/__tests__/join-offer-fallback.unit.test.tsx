/**
 * The shell's join offer falls back to user's account-security offer, as main's
 * DashboardPageBody did. Public pages never draw the shell body at all.
 */

import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { joinOffer } from "../navigation-host-capabilities";

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
