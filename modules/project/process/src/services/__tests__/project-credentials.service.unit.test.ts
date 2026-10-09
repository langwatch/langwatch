import { describe, expect, it } from "vitest";

import { isLegacyKeyRevoked } from "../../rules/legacy-project-key.rules.ts";
import { ProjectCredentialsService } from "../project-credentials.service.ts";

describe("ProjectCredentialsService", () => {
  describe("when a project is created", () => {
    /** @scenario "A project is born with packaged credentials" */
    it("mints a project KSUID identifier", () => {
      const adapter = ProjectCredentialsService.create();

      expect(adapter.generateProjectId()).toMatch(/^project_[a-zA-Z0-9]+$/);
      expect(adapter.generateProjectId()).not.toBe(adapter.generateProjectId());
    });

    /** @scenario "A new project gets no customer-facing project key" */
    it("stores a legacy key value that never authenticates", () => {
      const key = ProjectCredentialsService.create().generateApiKey();

      expect(key).toMatch(/^lw-revoked-\S+$/);
      expect(key).not.toMatch(/^sk-lw-/);
      expect(isLegacyKeyRevoked(key)).toBe(true);
    });

    /** @scenario "A new project gets no customer-facing project key" */
    it("stores a distinct value for every project, as the unique column needs", () => {
      const adapter = ProjectCredentialsService.create();

      expect(adapter.generateApiKey()).not.toBe(adapter.generateApiKey());
    });
  });
});
