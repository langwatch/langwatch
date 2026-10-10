// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";

import { GovernanceAiToolSlugService } from "../ai-tool-slug.service.ts";

describe("GovernanceAiToolSlugService", () => {
  describe("when a display name is given", () => {
    it("slugifies it and appends a house-scheme ksuid suffix", () => {
      const slug = GovernanceAiToolSlugService.create().generate("My Cool Tool!");

      expect(slug).toMatch(/^my-cool-tool-governance_[0-9A-Za-z]+$/);
    });
  });

  describe("when a display name has no alphanumeric characters", () => {
    it("falls back to the generic stem", () => {
      const slug = GovernanceAiToolSlugService.create().generate("!!!");

      expect(slug).toMatch(/^tool-governance_[0-9A-Za-z]+$/);
    });
  });

  describe("when generated twice", () => {
    it("never repeats the suffix", () => {
      const generator = GovernanceAiToolSlugService.create();

      expect(generator.generate("Tool")).not.toBe(generator.generate("Tool"));
    });
  });
});
