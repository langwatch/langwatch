/**
 * @vitest-environment node
 *
 * `findElevenLabsProviderForProject` resolves the one enabled ElevenLabs
 * provider row a project can reach, over the same scope chain every other
 * provider read uses. The repository is mocked at its seam so this exercises
 * only the elevenlabs + enabled selection.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findAllAccessibleForProject = vi.fn();
vi.mock("~/server/modelProviders/modelProvider.repository", () => ({
  ModelProviderRepository: class {
    findAllAccessibleForProject = (...args: unknown[]) =>
      findAllAccessibleForProject(...args);
  },
}));

vi.mock("~/server/db", () => ({ prisma: {} }));

import { findElevenLabsProviderForProject } from "../elevenLabsCredential.service";

beforeEach(() => vi.clearAllMocks());

describe("findElevenLabsProviderForProject", () => {
  describe("when the project has an enabled ElevenLabs row", () => {
    /** @scenario "The enabled ElevenLabs provider row is resolved for a project" */
    it("returns that row's id", async () => {
      findAllAccessibleForProject.mockResolvedValue([
        { id: "prov_openai", provider: "openai", enabled: true },
        { id: "prov_el", provider: "elevenlabs", enabled: true },
      ]);

      const result = await findElevenLabsProviderForProject("proj_1");

      expect(result).toEqual({ id: "prov_el" });
    });
  });

  describe("when no enabled ElevenLabs row is accessible", () => {
    /** @scenario "A project with no enabled ElevenLabs provider resolves none" */
    it("returns null for a disabled or non-ElevenLabs-only project", async () => {
      findAllAccessibleForProject.mockResolvedValue([
        { id: "prov_el_disabled", provider: "elevenlabs", enabled: false },
        { id: "prov_openai", provider: "openai", enabled: true },
      ]);

      const result = await findElevenLabsProviderForProject("proj_1");

      expect(result).toBeNull();
    });
  });
});
