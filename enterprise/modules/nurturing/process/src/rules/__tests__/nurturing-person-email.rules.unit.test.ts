/**
 * Every person call nurturing sends Customer.io carries the person's address, or is not sent.
 * @see enterprise/modules/nurturing/specs/nurturing.feature
 */
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import { describe, expect, it } from "vitest";

import { personUserIdsOf, withPersonEmails } from "../nurturing-person-email.rules.ts";

const emails = new Map([["user-1", "jane@example.com"]]);

describe("withPersonEmails", () => {
  describe("given an identify for a person with an address", () => {
    /** @scenario "Every Customer.io identify carries the person's email, or is not sent" */
    it("adds the address to its traits", () => {
      const calls: CioBatchCall[] = [
        { type: "identify", userId: "user-1", traits: { has_traces: true } },
      ];

      expect(withPersonEmails({ calls, emails })).toEqual([
        {
          type: "identify",
          userId: "user-1",
          traits: { has_traces: true, email: "jane@example.com" },
        },
      ]);
    });
  });

  describe("given calls for a person with no address", () => {
    /** @scenario "Every Customer.io identify carries the person's email, or is not sent" */
    it("drops the identify and the track, and keeps the group", () => {
      const calls: CioBatchCall[] = [
        { type: "identify", userId: "user-2", traits: { has_traces: true } },
        { type: "track", userId: "user-2", event: "joined_organization" },
        { type: "group", userId: "user-2", groupId: "org-1" },
      ];

      expect(withPersonEmails({ calls, emails })).toEqual([
        { type: "group", userId: "user-2", groupId: "org-1" },
      ]);
    });
  });

  describe("given a track for a person with an address and no identify before it", () => {
    /** @scenario "A Customer.io track goes behind an identify that carries the person's email" */
    it("sends an identify with the address first", () => {
      const calls: CioBatchCall[] = [
        { type: "track", userId: "user-1", event: "scenario_created" },
        { type: "track", userId: "user-1", event: "workflow_created" },
      ];

      expect(withPersonEmails({ calls, emails })).toEqual([
        { type: "identify", userId: "user-1", traits: { email: "jane@example.com" } },
        { type: "track", userId: "user-1", event: "scenario_created" },
        { type: "track", userId: "user-1", event: "workflow_created" },
      ]);
    });
  });

  describe("given a track after the person's identify in the same batch", () => {
    it("sends no second identify", () => {
      const calls: CioBatchCall[] = [
        { type: "identify", userId: "user-1", traits: {} },
        { type: "track", userId: "user-1", event: "signed_up" },
      ];

      expect(withPersonEmails({ calls, emails })).toEqual([
        { type: "identify", userId: "user-1", traits: { email: "jane@example.com" } },
        { type: "track", userId: "user-1", event: "signed_up" },
      ]);
    });
  });
});

describe("personUserIdsOf", () => {
  it("names each identified or tracked person once, and no grouped-only person", () => {
    const calls: CioBatchCall[] = [
      { type: "identify", userId: "user-1", traits: {} },
      { type: "track", userId: "user-1", event: "signed_up" },
      { type: "track", userId: "user-2", event: "signed_up" },
      { type: "group", userId: "user-3", groupId: "org-1" },
    ];

    expect(personUserIdsOf(calls)).toEqual(["user-1", "user-2"]);
  });
});
