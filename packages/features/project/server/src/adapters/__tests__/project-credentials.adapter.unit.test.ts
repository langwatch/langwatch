import { describe, expect, it } from "vitest";
import { ProjectCredentialsAdapter } from "../project-credentials.adapter";

/**
 * The onboarding snippets are sized against the 54-byte key this adapter
 * mints, and every stored Project row carries the id shape it mints, so both
 * assertions below are about a persisted format rather than a preference.
 */
describe("ProjectCredentialsAdapter", () => {
  describe("when a project is created", () => {
    /** @scenario "A project is born with packaged credentials" */
    it("mints a bare nanoid project identifier", () => {
      const adapter = ProjectCredentialsAdapter.create();

      expect(adapter.generateProjectId()).toMatch(/^[A-Za-z0-9_-]{21}$/);
      expect(adapter.generateProjectId()).not.toBe(adapter.generateProjectId());
    });

    /** @scenario "A project is born with packaged credentials" */
    it("mints a 54-byte sk-lw- ingestion key of alphanumeric characters only", () => {
      const key = ProjectCredentialsAdapter.create().generateApiKey();

      expect(key).toMatch(/^sk-lw-[0-9A-Za-z]{48}$/);
      expect(key.length).toBe(54);
    });

    /** @scenario "A project is born with packaged credentials" */
    it("mints a distinct key for every project", () => {
      const adapter = ProjectCredentialsAdapter.create();

      expect(adapter.generateApiKey()).not.toBe(adapter.generateApiKey());
    });
  });
});
