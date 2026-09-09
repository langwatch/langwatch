/**
 * Which state a sync control is in, and which unpressable it is when it is
 * one.
 *
 * The precedence is the point. Each of these inputs can be true at once, and a
 * control that answered the wrong one of the reader's questions would explain
 * itself accurately and unhelpfully — telling an administrator who just pressed
 * it that they have no providers, when what they need to know is that the ask
 * has already gone.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */

import { describe, expect, it } from "vitest";

import { governanceSyncStatus } from "../syncControlState";

const inputs = (over: Partial<Parameters<typeof governanceSyncStatus>[0]>) => ({
  canManage: true,
  sourcesLoading: false,
  sourceCount: 1,
  isAsking: false,
  asked: false,
  ...over,
});

describe("the state of a governance sync control", () => {
  describe("given a grant and a provider to ask", () => {
    /** @scenario "The sync control asks every provider that can list agents" */
    it("is ready", () => {
      expect(governanceSyncStatus(inputs({}))).toEqual({ state: "ready" });
    });
  });

  describe("given a request already recorded this page session", () => {
    /**
     * Beats every other reason, including ones that are also true. A second
     * press is dropped by the process manager rather than queued, so "you have
     * already asked" is the only answer that tells the reader what happened.
     */
    /** @scenario "A second press while a sync is in flight says so rather than doing nothing" */
    it("outranks having no provider left to ask", () => {
      expect(
        governanceSyncStatus(inputs({ asked: true, sourceCount: 0 })),
      ).toEqual({ state: "asked" });
    });

    /** @scenario "A second press while a sync is in flight says so rather than doing nothing" */
    it("yields to a request currently being recorded", () => {
      expect(
        governanceSyncStatus(inputs({ asked: true, isAsking: true })),
      ).toEqual({ state: "asking" });
    });
  });

  describe("given a reader without the grant", () => {
    /**
     * Ahead of the sources check: a reader who may not ask does not need to be
     * told how many providers they have, and saying so first would answer a
     * question they did not have.
     */
    /** @scenario "A reader who cannot sync is told why rather than shown nothing" */
    it("names the grant rather than the providers", () => {
      expect(
        governanceSyncStatus(inputs({ canManage: false, sourceCount: 0 })),
      ).toEqual({ state: "unavailable", because: "no_grant" });
    });
  });

  describe("given the providers read is still in flight", () => {
    /**
     * Not `no_provider`. A read that has not answered is not an answer of
     * none, and a control that flashed "no connected provider can list agents"
     * on every page load would teach readers to disbelieve it.
     */
    /** @scenario "An organization with no listing provider is told so" */
    it("says it is still checking rather than claiming none", () => {
      expect(
        governanceSyncStatus(inputs({ sourcesLoading: true, sourceCount: 0 })),
      ).toEqual({ state: "unavailable", because: "checking" });
    });
  });

  describe("given a settled read with no provider that can be asked", () => {
    /** @scenario "An organization with no listing provider is told so" */
    it("says there is none", () => {
      expect(governanceSyncStatus(inputs({ sourceCount: 0 }))).toEqual({
        state: "unavailable",
        because: "no_provider",
      });
    });
  });
});
