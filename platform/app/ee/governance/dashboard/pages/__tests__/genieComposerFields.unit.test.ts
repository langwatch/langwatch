// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment jsdom
 */

/**
 * The Genie composer's field order and the create payload it produces.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *
 * Databricks expires pasted workspace tokens ~1h after issuing, so the
 * service principal must be the way in and the token an Advanced option.
 * These tests pin the FieldDef declarations (order + advanced flags + hint
 * prose) and the pure buildCreateInput schedule resolution, so the drawer
 * integration tests can stay about rendering.
 */
import { describe, expect, it } from "vitest";
import type { ComposerState } from "../ingestion-sources";
import { buildCreateInput, PARSER_FIELDS } from "../ingestion-sources";

const genieFields = PARSER_FIELDS.databricks_genie;
const keysInOrder = genieFields.map((f) => f.key);

const genieComposer = (overrides: Partial<ComposerState>): ComposerState => ({
  sourceType: "databricks_genie",
  name: "Genie fleet",
  description: "",
  parserConfig: {
    workspaceUrl: "https://adb-123.7.azuredatabricks.net",
    credentialsClientId: "client-id",
    credentialsClientSecret: "client-secret",
  },
  ottlStatements: [],
  pullSchedule: "",
  ...overrides,
});

describe("given the Genie composer field definitions", () => {
  describe("when the form lays out its fields", () => {
    /** @scenario "Genie setup asks for the service principal first" */
    it("asks for workspace URL, then client ID, then secret, before anything else", () => {
      expect(keysInOrder.slice(0, 3)).toEqual([
        "workspaceUrl",
        "credentialsClientId",
        "credentialsClientSecret",
      ]);
    });

    /** @scenario "Genie setup asks for the service principal first" */
    it("marks the token, space IDs, and warehouse ID as Advanced", () => {
      const advancedKeys = genieFields
        .filter((f) => f.advanced)
        .map((f) => f.key);
      expect(advancedKeys).toEqual([
        "credentialsToken",
        "spaceIds",
        "warehouseId",
      ]);
    });

    /** @scenario "Genie setup asks for the service principal first" */
    it("keeps the primary trio out of the Advanced group", () => {
      for (const key of [
        "workspaceUrl",
        "credentialsClientId",
        "credentialsClientSecret",
      ]) {
        expect(genieFields.find((f) => f.key === key)?.advanced).toBeFalsy();
      }
    });
  });

  describe("when a hint mentions another field", () => {
    /** @scenario "Field hints name their fields instead of pointing at them" */
    it("names the field instead of locating it above or below", () => {
      for (const field of genieFields) {
        expect(
          field.hint ?? "",
          `${field.key} hint points positionally`,
        ).not.toMatch(/\babove\b|\bbelow\b/i);
      }
    });
  });
});

describe("given the create input for a pull-mode source", () => {
  describe("when the admin never touched the cadence", () => {
    /** @scenario "Leaving the cadence untouched keeps the recommended schedule" */
    it("carries the recommended schedule, never a schedule of none", () => {
      const input = buildCreateInput({
        composer: genieComposer({}),
        organizationId: "org-1",
      });
      expect(input?.pullSchedule).toBe("*/15 * * * *");
    });
  });

  describe("when the admin picked an hourly cadence", () => {
    /** @scenario "Picking a cadence saves exactly that schedule" */
    it("carries that schedule everywhere the schedule travels", () => {
      const input = buildCreateInput({
        composer: genieComposer({ pullSchedule: "0 * * * *" }),
        organizationId: "org-1",
      });
      expect(input?.pullSchedule).toBe("0 * * * *");
      // The Genie pull settings carry their own copy of the schedule; a
      // mismatch here means the puller runs a different cadence than the
      // one the admin was shown.
      expect(
        (input?.pullConfig as { schedule?: string } | null)?.schedule,
      ).toBe("0 * * * *");
    });
  });

  describe("when the Advanced group was never opened", () => {
    /** @scenario "Advanced options stay collapsed and never block create" */
    it("creates with an empty space list covering every visible space", () => {
      const input = buildCreateInput({
        composer: genieComposer({}),
        organizationId: "org-1",
      });
      expect(input).not.toBeNull();
      expect((input?.pullConfig as { spaceIds?: string[] }).spaceIds).toEqual(
        [],
      );
    });
  });
});
