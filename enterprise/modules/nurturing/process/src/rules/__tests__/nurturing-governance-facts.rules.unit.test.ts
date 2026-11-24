// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/governance-facts.feature
 */
import type { IngestionSourceFactData } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import {
  fireGovernanceSourceSignal,
  governanceSourceConnectedSignals,
  governanceSourceLiveSignals,
} from "../nurturing-governance-facts.rules.ts";

const FACT: IngestionSourceFactData = {
  tenantId: "org-1",
  organizationId: "org-1",
  sourceId: "source-1",
  sourceType: "claude_code",
  actorUserId: "user-creator",
  occurredAt: 4_000,
};

describe("governanceSourceConnectedSignals", () => {
  describe("given a source a person created", () => {
    const [signal] = governanceSourceConnectedSignals({ data: FACT });

    /** @scenario "A created source groups has_governance_source and tracks it to its creator" */
    it("is one signal to the creator, claimed once per source", () => {
      expect(signal).toEqual({
        kind: "governance_source_connected",
        sourceEventId: "source-1:connected",
        tenantId: "org-1",
        occurredAt: 4_000,
        userId: "user-creator",
        organizationId: "org-1",
        sourceId: "source-1",
        sourceType: "claude_code",
      });
    });

    /** @scenario "A created source groups has_governance_source and tracks it to its creator" */
    it("groups has_governance_source true, then tracks the event under the signal's id", () => {
      if (!signal) throw new Error("no governance signal");

      expect(fireGovernanceSourceSignal(signal)).toEqual([
        {
          type: "group",
          userId: "user-creator",
          groupId: "org-1",
          traits: { has_governance_source: true },
        },
        {
          type: "track",
          userId: "user-creator",
          event: "governance_source_connected",
          properties: {
            source_id: "source-1",
            source_type: "claude_code",
            organization_id: "org-1",
          },
          messageId: "source-1:connected",
        },
      ]);
    });
  });

  describe("given a source no person created", () => {
    /** @scenario "A governance source fact naming no person sends nothing" */
    it("is no signal", () => {
      expect(governanceSourceConnectedSignals({ data: { ...FACT, actorUserId: null } })).toEqual(
        [],
      );
    });
  });
});

describe("governanceSourceLiveSignals", () => {
  describe("given a source's first data", () => {
    const [signal] = governanceSourceLiveSignals({ data: FACT });

    /** @scenario "A source's first data groups has_governance_data and tracks it to its creator" */
    it("groups has_governance_data true, then tracks governance_source_live", () => {
      if (!signal) throw new Error("no governance signal");

      expect(signal.sourceEventId).toBe("source-1:live");
      expect(fireGovernanceSourceSignal(signal)).toEqual([
        {
          type: "group",
          userId: "user-creator",
          groupId: "org-1",
          traits: { has_governance_data: true },
        },
        {
          type: "track",
          userId: "user-creator",
          event: "governance_source_live",
          properties: {
            source_id: "source-1",
            source_type: "claude_code",
            organization_id: "org-1",
          },
          messageId: "source-1:live",
        },
      ]);
    });
  });

  describe("given a source no person created", () => {
    /** @scenario "A governance source fact naming no person sends nothing" */
    it("is no signal", () => {
      expect(governanceSourceLiveSignals({ data: { ...FACT, actorUserId: null } })).toEqual([]);
    });
  });
});
