// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/governance-facts.feature
 */
import type { IngestionSourceFactData } from "@langwatch/enterprise-governance-contract/ingestion-source-lifecycle";
import { describe, expect, it } from "vitest";

import {
  fireGovernanceSourceSignal,
  governanceSourceSignal,
} from "../nurturing-governance-facts.rules.ts";

const FACT: IngestionSourceFactData = {
  tenantId: "org-1",
  organizationId: "org-1",
  sourceId: "source-1",
  sourceType: "claude_code",
  actorUserId: "user-creator",
  occurredAt: 4_000,
};

const SOURCE_PROPERTIES = {
  source_id: "source-1",
  source_type: "claude_code",
  organization_id: "org-1",
};

describe("governanceSourceSignal", () => {
  describe("given a created source and its recipient", () => {
    const signal = governanceSourceSignal({
      kind: "governance_source_connected",
      data: FACT,
      userId: "user-creator",
    });

    /** @scenario "A created source groups has_governance_source and tracks it to its creator" */
    it("is one signal to the recipient, claimed once per source", () => {
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
          properties: SOURCE_PROPERTIES,
          messageId: "source-1:connected",
        },
      ]);
    });
  });

  describe("given a source's first data and its recipient", () => {
    const signal = governanceSourceSignal({
      kind: "governance_source_live",
      data: FACT,
      userId: "user-creator",
    });

    /** @scenario "A source's first data groups has_governance_data and tracks it to its creator" */
    it("groups has_governance_data true, then tracks governance_source_live", () => {
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
          properties: SOURCE_PROPERTIES,
          messageId: "source-1:live",
        },
      ]);
    });
  });

  describe("given the organization's admin as the recipient", () => {
    /** @scenario "A governance source fact naming no person goes to the organization's admin" */
    it("is the admin's signal, under the same claim as the creator's would be", () => {
      const signal = governanceSourceSignal({
        kind: "governance_source_connected",
        data: { ...FACT, actorUserId: null },
        userId: "user-admin",
      });

      expect(signal).toMatchObject({ userId: "user-admin", sourceEventId: "source-1:connected" });
    });
  });
});
