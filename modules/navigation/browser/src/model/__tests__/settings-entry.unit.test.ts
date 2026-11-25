/**
 * Where the Settings entries open: the project's own settings from inside a project the reader
 * may update, the organization's everywhere else (settings-shell-v2.feature, ADR-098 amendment).
 */

import { describe, expect, it } from "vitest";

import { settingsEntryHref, type SettingsEntryReading } from "../settings-entry.ts";

const SHARED_PROJECT = { slug: "checkout-bot", kind: "application", isPersonal: false };

const INSIDE_A_PROJECT: SettingsEntryReading = {
  projectSlugFromAddress: "checkout-bot",
  project: SHARED_PROJECT,
  isPersonalTeam: false,
  canUpdateProject: true,
};

const entry = (reading: Partial<SettingsEntryReading>) =>
  settingsEntryHref({ ...INSIDE_A_PROJECT, ...reading });

describe("given a page of a shared project the reader may update", () => {
  describe("when Settings is opened", () => {
    /** @scenario "Settings opened from a project lands on that project's settings" */
    it("opens the project's General page", () => {
      expect(entry({})).toBe("/settings/project");
    });
  });
});

describe("given a page that names no project", () => {
  describe("when Settings is opened", () => {
    /** @scenario "Settings opened from outside a project lands on the organization's settings" */
    it("opens the organization's General page, even with a remembered project", () => {
      expect(entry({ projectSlugFromAddress: undefined })).toBe("/settings");
    });
  });
});

describe("given the address names a project other than the one resolved", () => {
  describe("when Settings is opened", () => {
    it("opens the organization's General page rather than act on the wrong project", () => {
      expect(entry({ projectSlugFromAddress: "another-project" })).toBe("/settings");
      expect(entry({ project: undefined })).toBe("/settings");
    });
  });
});

describe("given the reader's personal workspace", () => {
  describe("when Settings is opened", () => {
    /** @scenario "Settings opened from a personal workspace lands on the organization's settings" */
    it("opens the organization's General page", () => {
      expect(entry({ isPersonalTeam: true })).toBe("/settings");
      expect(entry({ project: { ...SHARED_PROJECT, isPersonal: true } })).toBe("/settings");
    });
  });
});

describe("given an aggregate project", () => {
  describe("when Settings is opened", () => {
    /** @scenario "Settings opened from an aggregate project lands on the organization's settings" */
    it("opens the organization's General page", () => {
      expect(entry({ project: { ...SHARED_PROJECT, kind: "aggregate" } })).toBe("/settings");
    });
  });
});

describe("given a reader who may only view the project", () => {
  describe("when Settings is opened", () => {
    /** @scenario "A reader who may not update the project lands on the organization's settings" */
    it("opens the organization's General page", () => {
      expect(entry({ canUpdateProject: false })).toBe("/settings");
    });
  });
});
