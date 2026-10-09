/**
 * @vitest-environment jsdom
 * Organization lends by the tokens in its client package, so a reader finds them without
 * importing organization's browser package or naming a capability (§10.1).
 */
import {
  CreateProjectDrawerToken,
  CreateTeamDrawerToken,
  EditProjectDrawerToken,
  InviteMemberDrawerToken,
  JoinInsteadToken,
  JoinOfferToken,
  PendingJoinRequestsToken,
  PersonDrawerToken,
  ProjectDepartmentFieldToken,
} from "@langwatch/organization-client";
import { describe, expect, it } from "vitest";

import { organizationWeb } from "../organization.web.ts";

function lendOf({ key }: { key: string }) {
  return organizationWeb.installation.lends.find(({ token }) => token.key === key);
}

describe("the organization browser declaration", () => {
  describe("when a reader looks up each token from organization's client", () => {
    /** @scenario Each wave 3 owner lends by its client tokens */
    it.each([
      CreateProjectDrawerToken,
      CreateTeamDrawerToken,
      EditProjectDrawerToken,
      InviteMemberDrawerToken,
      PersonDrawerToken,
    ])("loads the lent drawer for $key", async (token) => {
      const lend = lendOf(token);
      const loaded = lend && "load" in lend ? await lend.load() : undefined;

      expect(loaded).toHaveProperty("default");
    });
    /** @scenario Each wave 3 owner lends by its client tokens */
    it.each([
      JoinOfferToken,
      JoinInsteadToken,
      PendingJoinRequestsToken,
      ProjectDepartmentFieldToken,
    ])("loads the lent component for $key", async (token) => {
      const lend = lendOf(token);
      const loaded = lend && "load" in lend ? await lend.load() : undefined;

      expect(loaded).toHaveProperty("default");
    });
  });
});
