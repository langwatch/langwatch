import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleGetPrompt } from "../tools/get-prompt.js";
import { handleUpdatePrompt } from "../tools/update-prompt.js";
import { getPrompt, updatePrompt } from "../langwatch-api.js";

// Partial mock (spread over the real module) rather than a full replacement:
// Scenario 11 dynamically imports create-mcp-server.js, which re-exports other
// langwatch-api.js members (e.g. LangWatchApiError) at tool-registration time.
// Only getPrompt needs to be a fake for these tests.
vi.mock("../langwatch-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../langwatch-api.js")>();
  return { ...actual, getPrompt: vi.fn(), updatePrompt: vi.fn() };
});

const mockGetPrompt = vi.mocked(getPrompt);
const mockUpdatePrompt = vi.mocked(updatePrompt);

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Widened local fixture types. The real `PromptVersion`/`PromptDetailResponse`
 * in ../langwatch-api.ts are currently too narrow (missing parameters, inputs,
 * outputs, tags, versionId, temperature, maxTokens, responseFormat) — that is
 * exactly the bug under test. A later task widens the real types; until then,
 * fixtures here are typed independently of them.
 *
 * NOTE: the shape of `parameters`/`inputs`/`outputs` entries below
 * (`{ identifier, type }`) is a best-effort assumption, not verified against
 * the live API contract (out of this task's read scope) — confirm before
 * relying on the exact field names in the fix.
 */
interface FixturePromptVersion {
  version?: number;
  versionId?: string;
  commitMessage?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: Record<string, unknown>;
  parameters?: Array<{ identifier: string; type: string }>;
  inputs?: Array<{ identifier: string; type: string }>;
  outputs?: Array<{ identifier: string; type: string }>;
  messages?: Array<{ role: string; content: string }>;
  tags?: string[];
}

interface FixturePrompt {
  id?: string;
  handle?: string;
  name?: string;
  latestVersionNumber?: number;
  versions?: FixturePromptVersion[];
}

describe("handleGetPrompt()", () => {
  describe("when the returned version has every renderable field set", () => {
    /** @scenario "Rendering every field that changes how the prompt is called" */
    it("renders headings and readable text for parameters, inputs, outputs, model, temperature, maxTokens, and responseFormat", async () => {
      const richVersion: FixturePromptVersion = {
        version: 3,
        versionId: "ver_rich001",
        model: "gpt-5-mini",
        temperature: 0.7,
        maxTokens: 512,
        responseFormat: { type: "json_schema", name: "answer_schema" },
        parameters: [{ identifier: "temperature", type: "float" }],
        inputs: [{ identifier: "question", type: "str" }],
        outputs: [{ identifier: "answer", type: "str" }],
        messages: [{ role: "user", content: "{{question}}" }],
        tags: [],
      };
      const fixture: FixturePrompt = {
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 3,
        versions: [richVersion],
      };
      mockGetPrompt.mockResolvedValue(fixture as any);

      const result = await handleGetPrompt({ idOrHandle: "my-prompt" });

      expect(result).toMatch(/parameters/i);
      expect(result).toMatch(/inputs/i);
      expect(result).toMatch(/outputs/i);
      expect(result).toMatch(/model/i);
      expect(result).toMatch(/temperature/i);
      expect(result).toMatch(/max ?tokens/i);
      expect(result).toMatch(/response ?format/i);
      expect(result).toContain("question");
      expect(result).toContain("str");
      expect(result).toContain("answer");
      expect(result).not.toContain("[object Object]");
    });
  });

  describe("when the returned version has none of those fields set", () => {
    /** @scenario "Omitting headings for fields absent from the API response" */
    it("renders no heading for parameters, inputs, outputs, model, temperature, maxTokens, or responseFormat", async () => {
      const bareVersion: FixturePromptVersion = {
        version: 1,
        versionId: "ver_bare001",
        commitMessage: "Initial version",
      };
      const fixture: FixturePrompt = {
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 1,
        versions: [bareVersion],
      };
      mockGetPrompt.mockResolvedValue(fixture as any);

      const result = await handleGetPrompt({ idOrHandle: "my-prompt" });

      expect(result).not.toMatch(/#+\s*parameters/i);
      expect(result).not.toMatch(/#+\s*inputs/i);
      expect(result).not.toMatch(/#+\s*outputs/i);
      expect(result).not.toMatch(/#+\s*temperature/i);
      expect(result).not.toMatch(/#+\s*max ?tokens/i);
      expect(result).not.toMatch(/#+\s*response ?format/i);
      expect(result).not.toContain("[object Object]");
    });
  });

  describe("when a pinned older version has every renderable field set", () => {
    /** @scenario "Rendering the pinned version's fields when version pins an older one" */
    it("renders the pinned version's fields, not the latest version's", async () => {
      const olderVersion: FixturePromptVersion = {
        version: 2,
        versionId: "ver_older002",
        model: "gpt-5-mini",
        temperature: 0.5,
        maxTokens: 256,
        responseFormat: { type: "json_schema", name: "answer_schema" },
        parameters: [{ identifier: "temperature", type: "float" }],
        inputs: [{ identifier: "question", type: "str" }],
        outputs: [{ identifier: "answer", type: "str" }],
        messages: [{ role: "user", content: "{{question}}" }],
        tags: [],
      };
      // latestVersionNumber (5) is intentionally higher than the pinned
      // version (2) to make "older" unambiguous in this fixture.
      const fixture: FixturePrompt = {
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 5,
        versions: [olderVersion],
      };
      mockGetPrompt.mockResolvedValue(fixture as any);

      const result = await handleGetPrompt({ idOrHandle: "my-prompt", version: 2 });

      expect(mockGetPrompt).toHaveBeenCalledWith(
        "my-prompt",
        expect.objectContaining({ version: 2 })
      );
      expect(result).toMatch(/parameters/i);
      expect(result).toMatch(/inputs/i);
      expect(result).toMatch(/outputs/i);
      expect(result).toMatch(/temperature/i);
      expect(result).toMatch(/max ?tokens/i);
      expect(result).toMatch(/response ?format/i);
      expect(result).toContain("question");
      expect(result).toContain("str");
      expect(result).toContain("answer");
      expect(result).not.toContain("[object Object]");
    });
  });

  describe("when the returned version is tagged with multiple deployment tags", () => {
    /** @scenario "Listing tags currently assigned to the returned version" */
    it("lists production and staging as deployments of the returned version", async () => {
      const version: FixturePromptVersion = {
        version: 1,
        versionId: "ver_tags001",
        tags: ["production", "staging"],
      };
      const fixture: FixturePrompt = {
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 1,
        versions: [version],
      };
      mockGetPrompt.mockResolvedValue(fixture as any);

      const result = await handleGetPrompt({ idOrHandle: "my-prompt" });

      expect(result).toContain("production");
      expect(result).toContain("staging");
    });
  });

  describe("when the returned version has no tags but an older version is tagged production", () => {
    /** @scenario "Never implying a tag is undeployed everywhere when it is only absent from this version" */
    it("states production is not assigned to the returned version, without claiming it is undeployed", async () => {
      const returnedVersion: FixturePromptVersion = {
        version: 2,
        versionId: "ver_v2",
        tags: [],
      };
      const olderTaggedVersion: FixturePromptVersion = {
        version: 1,
        versionId: "ver_v1",
        tags: ["production"],
      };
      const fixture: FixturePrompt = {
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 2,
        versions: [returnedVersion, olderTaggedVersion],
      };
      mockGetPrompt.mockResolvedValue(fixture as any);

      const result = await handleGetPrompt({ idOrHandle: "my-prompt" });

      // Fails first against current code: "production" is never rendered at all.
      expect(result).toMatch(/production/i);
      expect(result).not.toMatch(/production["']?\s+is\s+(?:not\s+)?undeployed/i);
      expect(result).not.toMatch(/production["']?[^.\n]*not\s+deployed\s+anywhere/i);
    });
  });

  describe("when the returned version is tagged only with the built-in latest tag", () => {
    /** @scenario "Rendering an empty deployments section when the version carries only the built-in latest tag" */
    it("renders an empty deployments section with no claim the prompt is undeployed", async () => {
      const version: FixturePromptVersion = {
        version: 1,
        versionId: "ver_v1",
        tags: ["latest"],
      };
      const fixture: FixturePrompt = {
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 1,
        versions: [version],
      };
      mockGetPrompt.mockResolvedValue(fixture as any);

      const result = await handleGetPrompt({ idOrHandle: "my-prompt" });

      // Fails against current code: no "Deployments" section is ever rendered.
      expect(result).toMatch(/deployments?/i);
      expect(result).not.toMatch(/not deployed anywhere/i);
    });
  });

  describe("when the returned version is tagged with a custom tag", () => {
    /** @scenario "Listing a custom tag as a deployment" */
    it("lists canary as a deployment of the returned version", async () => {
      const version: FixturePromptVersion = {
        version: 1,
        versionId: "ver_v1",
        tags: ["canary"],
      };
      const fixture: FixturePrompt = {
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 1,
        versions: [version],
      };
      mockGetPrompt.mockResolvedValue(fixture as any);

      const result = await handleGetPrompt({ idOrHandle: "my-prompt" });

      expect(result).toContain("canary");
    });
  });

  describe("when a prompt version exists", () => {
    /** @scenario "Including the returned version's versionId" */
    it("includes the returned version's versionId", async () => {
      const version: FixturePromptVersion = {
        version: 1,
        versionId: "ver_xyz789",
      };
      const fixture: FixturePrompt = {
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 1,
        versions: [version],
      };
      mockGetPrompt.mockResolvedValue(fixture as any);

      const result = await handleGetPrompt({ idOrHandle: "my-prompt" });

      expect(result).toContain("ver_xyz789");
    });
  });

  describe("when called with format json", () => {
    /** @scenario "Requesting the unabridged API payload via format json" */
    it("returns a response that parses as the full platform_get_prompt API payload", async () => {
      const fixture: FixturePrompt = {
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 1,
        versions: [{ version: 1, versionId: "ver_v1", model: "gpt-5-mini" }],
      };
      mockGetPrompt.mockResolvedValue(fixture as any);

      const result = await handleGetPrompt({
        idOrHandle: "my-prompt",
        format: "json",
      } as any);

      // Fails against current code: the response is markdown, not JSON, so
      // JSON.parse throws (an uncaught throw fails the test).
      const parsed = JSON.parse(result);
      expect(parsed).toEqual(fixture);
    });
  });

  describe("when called without a format argument", () => {
    /** @scenario "Defaulting to the digest format when format is omitted" */
    it("returns the rendered digest, not the raw API payload", async () => {
      const fixture: FixturePrompt = {
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 1,
        versions: [{ version: 1, versionId: "ver_v1", model: "gpt-5-mini" }],
      };
      mockGetPrompt.mockResolvedValue(fixture as any);

      const result = await handleGetPrompt({ idOrHandle: "my-prompt" });

      expect(result).not.toEqual(JSON.stringify(fixture));
      expect(() => JSON.parse(result)).toThrow();
      expect(result).toMatch(/^# Prompt:/);
    });
  });
});

describe("MCP server platform_get_prompt tool registration", () => {
  describe("when inspecting the registered tool's input schema and description", () => {
    /** @scenario "Documenting the format parameter on the registered tool schema" */
    it("exposes a format parameter accepting digest or json and documents it in the description", async () => {
      const { createMcpServer } = await import("../create-mcp-server.js");
      const server = createMcpServer();
      const registeredTools = (
        server as unknown as {
          _registeredTools: Record<
            string,
            { description?: string; inputSchema?: { shape?: Record<string, unknown> } }
          >;
        }
      )._registeredTools;

      const tool = registeredTools["platform_get_prompt"];
      expect(tool).toBeDefined();

      const shapeKeys = Object.keys(tool?.inputSchema?.shape ?? {});
      // Fails against current code: no "format" key is registered at all.
      expect(shapeKeys).toContain("format");
      expect(tool?.description ?? "").toMatch(/format/i);
    });
  });
});

/**
 * Write-path spec (issue #5666 AC5-9). These tests define the contract the
 * fix must implement: after updatePrompt succeeds, the tool re-fetches the
 * prompt via getPrompt to derive authoritative state (the mutation response
 * alone does not carry applied tags), finds the new version by matching the
 * request's commitMessage, and reports versionId and deployment state from
 * that version's tags (the built-in "latest" tag is never a deployment).
 * On updatePrompt failure with tags requested, the tool re-fetches and
 * matches by commitMessage to detect the committed-but-untagged version
 * (the platform commits the version before assigning tags).
 */

/** No single output line may pair a version number with a deployment tag name. */
function expectNoLineMixesVersionAndTag(result: string, tags: string[]) {
  for (const line of result.split("\n")) {
    const hasTag = tags.some((t) => line.includes(t));
    if (hasTag) {
      expect(line).not.toMatch(/\bv?\d+\b.*\b(version)\b|\bversion\b.*\bv?\d+\b/i);
    }
  }
}

describe("handleUpdatePrompt()", () => {
  const { getPrompt: mockedGetPrompt } = { getPrompt: mockGetPrompt };

  describe("when the server applies different tags than the request asked for", () => {
    /** @scenario "Deriving tag and deployment state from the server response, not the request" */
    it("reflects the tags the server applied, not the request's tags", async () => {
      mockUpdatePrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 4,
      } as any);
      mockedGetPrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 4,
        versions: [
          {
            version: 4,
            versionId: "ver_new004",
            commitMessage: "Update greeting",
            tags: ["staging", "latest"],
          },
        ],
      } as any);

      const result = await handleUpdatePrompt({
        idOrHandle: "my-prompt",
        commitMessage: "Update greeting",
        tags: ["production"],
      });

      expect(result).toContain("staging");
      // The request asked for production but the server did not apply it;
      // echoing the request's tags is exactly the bug under test.
      expect(result).not.toContain("production");
    });
  });

  describe("when an update without tags lands on a prompt with existing deployments", () => {
    /** @scenario "Reporting a new version as not deployed and existing deployments as untouched" */
    it("states the new version is not deployed and production/staging were left untouched", async () => {
      mockUpdatePrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 6,
      } as any);
      mockedGetPrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 6,
        versions: [
          {
            version: 6,
            versionId: "ver_new006",
            commitMessage: "Tweak wording",
            tags: ["latest"],
          },
          {
            version: 5,
            versionId: "ver_old005",
            commitMessage: "Prior stable",
            tags: ["production", "staging"],
          },
        ],
      } as any);

      const result = await handleUpdatePrompt({
        idOrHandle: "my-prompt",
        commitMessage: "Tweak wording",
      });

      expect(result).toMatch(/not deployed/i);
      expect(result).toMatch(/production/);
      expect(result).toMatch(/staging/);
      expect(result).toMatch(/untouched|unchanged|still point/i);
      expectNoLineMixesVersionAndTag(result, ["production", "staging"]);
    });
  });

  describe("when a requested tag was actually assigned by the server", () => {
    /** @scenario "Using the word deployed only when a tag was actually assigned" */
    it("says the new version is deployed to production", async () => {
      mockUpdatePrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 7,
      } as any);
      mockedGetPrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 7,
        versions: [
          {
            version: 7,
            versionId: "ver_new007",
            commitMessage: "Ship it",
            tags: ["production", "latest"],
          },
        ],
      } as any);

      const result = await handleUpdatePrompt({
        idOrHandle: "my-prompt",
        commitMessage: "Ship it",
        tags: ["production"],
      });

      expect(result).toMatch(/deployed/i);
      expect(result).toContain("production");
      expectNoLineMixesVersionAndTag(result, ["production"]);
    });
  });

  describe("when the requested tag did not previously exist on the prompt", () => {
    /** @scenario "Assigning a tag that did not previously exist on the prompt" */
    it("says the new version is deployed to canary", async () => {
      mockUpdatePrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 2,
      } as any);
      mockedGetPrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 2,
        versions: [
          {
            version: 2,
            versionId: "ver_new002",
            commitMessage: "First canary",
            tags: ["canary", "latest"],
          },
        ],
      } as any);

      const result = await handleUpdatePrompt({
        idOrHandle: "my-prompt",
        commitMessage: "First canary",
        tags: ["canary"],
      });

      expect(result).toMatch(/deployed/i);
      expect(result).toContain("canary");
    });
  });

  describe("when the server response carries only the built-in latest tag", () => {
    /** @scenario "Never presenting the built-in latest tag as a deployment after an update" */
    it("does not list latest as a deployment", async () => {
      mockUpdatePrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 3,
      } as any);
      mockedGetPrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 3,
        versions: [
          {
            version: 3,
            versionId: "ver_new003",
            commitMessage: "Plain update",
            tags: ["latest"],
          },
        ],
      } as any);

      const result = await handleUpdatePrompt({
        idOrHandle: "my-prompt",
        commitMessage: "Plain update",
      });

      expect(result).not.toMatch(/deployed to.*latest/i);
      expect(result).not.toMatch(/\*\*Tags\*\*.*latest/);
    });
  });

  describe("when the update creates a new version", () => {
    /** @scenario "Including the new version's versionId" */
    it("includes the new version's versionId", async () => {
      mockUpdatePrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 9,
      } as any);
      mockedGetPrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 9,
        versions: [
          {
            version: 9,
            versionId: "ver_new009",
            commitMessage: "Add disclaimer",
            tags: ["latest"],
          },
        ],
      } as any);

      const result = await handleUpdatePrompt({
        idOrHandle: "my-prompt",
        commitMessage: "Add disclaimer",
      });

      expect(result).toContain("ver_new009");
    });
  });

  describe("when tag assignment fails but the version was committed", () => {
    /** @scenario "Reporting a version as created but untagged when tag assignment fails and a matching version is found" */
    it("reports the version as created and untagged, with its versionId and the failed tag", async () => {
      const { LangWatchApiError } = await import("../langwatch-api.js");
      mockUpdatePrompt.mockRejectedValue(
        new LangWatchApiError("Tag assignment rejected", 422, "{}")
      );
      mockedGetPrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 8,
        versions: [
          {
            version: 8,
            versionId: "ver_orphan8",
            commitMessage: "Risky change",
            tags: ["latest"],
          },
        ],
      } as any);

      const result = await handleUpdatePrompt({
        idOrHandle: "my-prompt",
        commitMessage: "Risky change",
        tags: ["production"],
      });

      expect(result).toMatch(/created/i);
      expect(result).toMatch(/untagged|not.*(tagged|deployed)/i);
      expect(result).toContain("ver_orphan8");
      expect(result).toContain("production");
    });
  });

  describe("when tag assignment fails and no matching version exists", () => {
    /** @scenario "Reporting a plain failure when tag assignment fails and no matching version is found" */
    it("reports a plain failure with no versionId", async () => {
      const { LangWatchApiError } = await import("../langwatch-api.js");
      mockUpdatePrompt.mockRejectedValue(
        new LangWatchApiError("Tag assignment rejected", 422, "{}")
      );
      mockedGetPrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        latestVersionNumber: 8,
        versions: [
          {
            version: 8,
            versionId: "ver_other08",
            commitMessage: "Unrelated commit",
            tags: ["latest"],
          },
        ],
      } as any);

      const result = await handleUpdatePrompt({
        idOrHandle: "my-prompt",
        commitMessage: "Risky change",
        tags: ["production"],
      });

      expect(result).toMatch(/fail/i);
      expect(result).not.toContain("ver_other08");
    });
  });
});
