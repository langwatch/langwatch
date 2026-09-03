import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleGetPrompt } from "../tools/get-prompt.js";
import { handleUpdatePrompt } from "../tools/update-prompt.js";
import {
  getPrompt,
  getPromptVersions,
  updatePrompt,
  type PromptDetailResponse,
  type PromptVersion,
} from "../langwatch-api.js";

// Partial mock (spread over the real module) rather than a full replacement:
// Scenario 11 dynamically imports create-mcp-server.js, which re-exports other
// langwatch-api.js members (e.g. LangWatchApiError) at tool-registration time.
// Only the prompt read/write functions need to be fakes for these tests.
vi.mock("../langwatch-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../langwatch-api.js")>();
  return {
    ...actual,
    getPrompt: vi.fn(),
    getPromptVersions: vi.fn(),
    updatePrompt: vi.fn(),
  };
});

const mockGetPrompt = vi.mocked(getPrompt);
const mockGetPromptVersions = vi.mocked(getPromptVersions);
const mockUpdatePrompt = vi.mocked(updatePrompt);

beforeEach(() => {
  vi.clearAllMocks();
  // The versions listing is only a fallback; default to "no versions found"
  // so tests exercising the top-level commitMessage match stay honest.
  mockGetPromptVersions.mockResolvedValue([]);
});

/**
 * Fixtures below mirror the real `GET /api/prompts/:id` contract
 * (apiResponsePromptWithVersionDataSchema in
 * packages/features/prompt/server/src/transport/api-rest/prompt.api.ts):
 * the returned version's data is flattened to the top level, `parameters`
 * is an object map (runtimeParametersSchema, defaulting to {}), `tags` is
 * an array of { name, versionId } objects, and there is NO nested
 * `versions` array — version history lives behind GET /:id/versions.
 */

describe("handleGetPrompt()", () => {
  describe("given the API returns the latest version with full data", () => {
    describe("when the returned version has every renderable field set", () => {
      /** @scenario "Rendering every field that changes how the prompt is called" */
      it("renders headings and readable text for parameters, inputs, outputs, model, temperature, maxTokens, and responseFormat", async () => {
        const fixture: PromptDetailResponse = {
          id: "prompt_1",
          handle: "my-prompt",
          version: 3,
          versionId: "ver_rich001",
          model: "gpt-5-mini",
          temperature: 0.7,
          maxTokens: 512,
          responseFormat: { type: "json_schema", name: "answer_schema" },
          parameters: { reasoning_effort: "low" },
          inputs: [{ identifier: "question", type: "str" }],
          outputs: [{ identifier: "answer", type: "str" }],
          messages: [{ role: "user", content: "{{question}}" }],
          tags: [],
        };
        mockGetPrompt.mockResolvedValue(fixture);

        const result = await handleGetPrompt({ idOrHandle: "my-prompt" });

        expect(result).toMatch(/parameters/i);
        expect(result).toMatch(/inputs/i);
        expect(result).toMatch(/outputs/i);
        expect(result).toMatch(/model/i);
        expect(result).toMatch(/temperature/i);
        expect(result).toMatch(/max ?tokens/i);
        expect(result).toMatch(/response ?format/i);
        expect(result).toContain("reasoning_effort");
        expect(result).toContain("question");
        expect(result).toContain("str");
        expect(result).toContain("answer");
        expect(result).not.toContain("[object Object]");
      });
    });
  });
  describe("when the returned version has none of those fields set", () => {
    /** @scenario "Omitting headings for fields absent from the API response" */
    it("renders no heading for parameters, inputs, outputs, model, temperature, maxTokens, or responseFormat", async () => {
      const fixture: PromptDetailResponse = {
        id: "prompt_1",
        handle: "my-prompt",
        version: 1,
        versionId: "ver_bare001",
        commitMessage: "Initial version",
        // The API defaults parameters to {} — an empty map, not an array.
        parameters: {},
        tags: [],
      };
      mockGetPrompt.mockResolvedValue(fixture);

      const result = await handleGetPrompt({ idOrHandle: "my-prompt" });

      expect(result).not.toMatch(/#+\s*parameters/i);
      expect(result).not.toMatch(/#+\s*inputs/i);
      expect(result).not.toMatch(/#+\s*outputs/i);
      expect(result).not.toMatch(/#+\s*temperature/i);
      expect(result).not.toMatch(/#+\s*max ?tokens/i);
      expect(result).not.toMatch(/#+\s*response ?format/i);
      expect(result).not.toContain("[object Object]");
      expect(result).not.toContain("**Parameters**");
    });
  });

  describe("when a pinned older version has every renderable field set", () => {
    /** @scenario "Rendering the pinned version's fields when version pins an older one" */
    it("renders the pinned version's fields, not the latest version's", async () => {
      // Pinning version=2 makes the API return that version's data at the
      // top level.
      const fixture: PromptDetailResponse = {
        id: "prompt_1",
        handle: "my-prompt",
        version: 2,
        versionId: "ver_older002",
        model: "gpt-5-mini",
        temperature: 0.5,
        maxTokens: 256,
        responseFormat: { type: "json_schema", name: "answer_schema" },
        parameters: { seed: 42 },
        inputs: [{ identifier: "question", type: "str" }],
        outputs: [{ identifier: "answer", type: "str" }],
        messages: [{ role: "user", content: "{{question}}" }],
        tags: [],
      };
      mockGetPrompt.mockResolvedValue(fixture);

      const result = await handleGetPrompt({ idOrHandle: "my-prompt", version: 2 });

      expect(mockGetPrompt).toHaveBeenCalledWith(
        "my-prompt",
        expect.objectContaining({ version: 2 }),
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
      const fixture: PromptDetailResponse = {
        id: "prompt_1",
        handle: "my-prompt",
        version: 1,
        versionId: "ver_tags001",
        tags: [
          { name: "production", versionId: "ver_tags001" },
          { name: "staging", versionId: "ver_tags001" },
          { name: "latest", versionId: "ver_tags001" },
        ],
      };
      mockGetPrompt.mockResolvedValue(fixture);

      const result = await handleGetPrompt({ idOrHandle: "my-prompt" });

      expect(result).toContain("production");
      expect(result).toContain("staging");
    });
  });

  describe("when the returned version has no tags of its own but production points at an older version", () => {
    /** @scenario "Never implying a tag is undeployed everywhere when it is only absent from this version" */
    it("lists production against the version it points to, without claiming it is undeployed", async () => {
      const fixture: PromptDetailResponse = {
        id: "prompt_1",
        handle: "my-prompt",
        version: 2,
        versionId: "ver_v2",
        tags: [
          { name: "latest", versionId: "ver_v2" },
          { name: "production", versionId: "ver_v1" },
        ],
      };
      mockGetPrompt.mockResolvedValue(fixture);

      const result = await handleGetPrompt({ idOrHandle: "my-prompt" });

      const deploymentsSection = result.split("## Deployments")[1] ?? "";
      expect(deploymentsSection).toContain("production");
      expect(deploymentsSection).toContain("ver_v1");
      // The tag points at another version, so it must not be marked as
      // assigned to the returned one.
      expect(deploymentsSection).not.toMatch(/production.*\(this version\)/);
      expect(result).not.toMatch(/undeployed/i);
      expect(result).not.toMatch(/not\s+deployed\s+anywhere/i);
    });
  });

  describe("when the returned version is tagged only with the built-in latest tag", () => {
    /** @scenario "Rendering an empty deployments section when the version carries only the built-in latest tag" */
    it("renders an empty deployments section with no claim the prompt is undeployed", async () => {
      const fixture: PromptDetailResponse = {
        id: "prompt_1",
        handle: "my-prompt",
        version: 1,
        versionId: "ver_v1",
        tags: [{ name: "latest", versionId: "ver_v1" }],
      };
      mockGetPrompt.mockResolvedValue(fixture);

      const result = await handleGetPrompt({ idOrHandle: "my-prompt" });

      expect(result).toMatch(/deployments?/i);
      expect(result).not.toContain("- latest");
      expect(result).not.toMatch(/not deployed anywhere/i);
    });
  });

  describe("when the returned version is tagged with a custom tag", () => {
    /** @scenario "Listing a custom tag as a deployment" */
    it("lists canary as a deployment of the returned version", async () => {
      const fixture: PromptDetailResponse = {
        id: "prompt_1",
        handle: "my-prompt",
        version: 1,
        versionId: "ver_v1",
        tags: [{ name: "canary", versionId: "ver_v1" }],
      };
      mockGetPrompt.mockResolvedValue(fixture);

      const result = await handleGetPrompt({ idOrHandle: "my-prompt" });

      expect(result).toContain("canary");
    });
  });

  describe("when a prompt version exists", () => {
    /** @scenario "Including the returned version's versionId" */
    it("includes the returned version's versionId", async () => {
      const fixture: PromptDetailResponse = {
        id: "prompt_1",
        handle: "my-prompt",
        version: 1,
        versionId: "ver_xyz789",
        tags: [],
      };
      mockGetPrompt.mockResolvedValue(fixture);

      const result = await handleGetPrompt({ idOrHandle: "my-prompt" });

      expect(result).toContain("ver_xyz789");
    });
  });

  describe("when the API returns unexpected shapes for parameters and tags", () => {
    /** @scenario "Rendering every field that changes how the prompt is called" */
    it("does not crash on an array parameters shape or string tags", async () => {
      // Defensive: the pre-fix code crashed with "fields is not iterable"
      // on the real object-map parameters; the fix must survive both the
      // real shape and the legacy/assumed ones.
      const fixture = {
        id: "prompt_1",
        handle: "my-prompt",
        version: 1,
        versionId: "ver_v1",
        parameters: [{ identifier: "temperature", type: "float" }],
        tags: ["production", "latest"],
      } as unknown as PromptDetailResponse;
      mockGetPrompt.mockResolvedValue(fixture);

      const result = await handleGetPrompt({ idOrHandle: "my-prompt" });

      expect(result).toContain("temperature");
      expect(result).toContain("production");
      expect(result).not.toContain("[object Object]");
    });
  });

  describe("when called with format json", () => {
    /** @scenario "Requesting the unabridged API payload via format json" */
    it("returns a response that parses as the full platform_get_prompt API payload", async () => {
      const fixture: PromptDetailResponse = {
        id: "prompt_1",
        handle: "my-prompt",
        version: 1,
        versionId: "ver_v1",
        model: "gpt-5-mini",
        parameters: {},
        tags: [],
      };
      mockGetPrompt.mockResolvedValue(fixture);

      const result = await handleGetPrompt({
        idOrHandle: "my-prompt",
        format: "json",
      });

      const parsed = JSON.parse(result);
      expect(parsed).toEqual(fixture);
    });
  });

  describe("when called without a format argument", () => {
    /** @scenario "Defaulting to the digest format when format is omitted" */
    it("returns the rendered digest, not the raw API payload", async () => {
      const fixture: PromptDetailResponse = {
        id: "prompt_1",
        handle: "my-prompt",
        version: 1,
        versionId: "ver_v1",
        model: "gpt-5-mini",
        tags: [],
      };
      mockGetPrompt.mockResolvedValue(fixture);

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
      expect(shapeKeys).toContain("format");
      expect(tool?.description ?? "").toMatch(/format/i);
    });
  });
});

/**
 * Write-path spec (issue #5666 AC5-9). After updatePrompt succeeds, the tool
 * re-fetches the prompt via getPrompt to derive authoritative state (the
 * mutation response alone does not carry applied tags). The GET response is
 * the prompt's latest version flattened to the top level, so the new version
 * is identified by matching the request's commitMessage against the
 * top-level commitMessage (falling back to GET /:id/versions), and
 * deployment state comes from the tags whose versionId points at it (the
 * built-in "latest" tag is never a deployment). On updatePrompt failure with
 * tags requested, the tool re-fetches and matches the same way to detect the
 * committed-but-untagged version (the platform commits the version before
 * assigning tags).
 */

/** No single output line may pair a version number with a deployment tag name. */
function expectNoLineMixesVersionAndTag(result: string, tags: string[]) {
  for (const line of result.split("\n")) {
    const hasTag = tags.some((t) => line.includes(t));
    if (hasTag) {
      expect(line).not.toMatch(/\bv\d+\b|\bversion\b\W*\d+/i);
    }
  }
}

describe("handleUpdatePrompt()", () => {
  describe("when the server applies different tags than the request asked for", () => {
    /** @scenario "Deriving tag and deployment state from the server response, not the request" */
    it("reflects the tags the server applied, not the request's tags", async () => {
      mockUpdatePrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
      });
      mockGetPrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        version: 4,
        versionId: "ver_new004",
        commitMessage: "Update greeting",
        tags: [
          { name: "staging", versionId: "ver_new004" },
          { name: "latest", versionId: "ver_new004" },
        ],
      });

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
      });
      mockGetPrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        version: 6,
        versionId: "ver_new006",
        commitMessage: "Tweak wording",
        tags: [
          { name: "latest", versionId: "ver_new006" },
          { name: "production", versionId: "ver_old005" },
          { name: "staging", versionId: "ver_old005" },
        ],
      });

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
      });
      mockGetPrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        version: 7,
        versionId: "ver_new007",
        commitMessage: "Ship it",
        tags: [
          { name: "production", versionId: "ver_new007" },
          { name: "latest", versionId: "ver_new007" },
        ],
      });

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
      });
      mockGetPrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        version: 2,
        versionId: "ver_new002",
        commitMessage: "First canary",
        tags: [
          { name: "canary", versionId: "ver_new002" },
          { name: "latest", versionId: "ver_new002" },
        ],
      });

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
      });
      mockGetPrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        version: 3,
        versionId: "ver_new003",
        commitMessage: "Plain update",
        tags: [{ name: "latest", versionId: "ver_new003" }],
      });

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
      });
      mockGetPrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        version: 9,
        versionId: "ver_new009",
        commitMessage: "Add disclaimer",
        tags: [{ name: "latest", versionId: "ver_new009" }],
      });

      const result = await handleUpdatePrompt({
        idOrHandle: "my-prompt",
        commitMessage: "Add disclaimer",
      });

      expect(result).toContain("ver_new009");
    });
  });

  describe("when the re-fetched top level does not match but the versions listing does", () => {
    /** @scenario "Including the new version's versionId" */
    it("identifies the new version via the versions listing fallback", async () => {
      mockUpdatePrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
      });
      // A concurrent update landed after ours: the top level shows a newer
      // commit, but GET /:id/versions still lists ours.
      mockGetPrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        version: 13,
        versionId: "ver_racer013",
        commitMessage: "Someone else's commit",
        tags: [{ name: "latest", versionId: "ver_racer013" }],
      });
      const listedVersions: PromptVersion[] = [
        { version: 13, versionId: "ver_racer013", commitMessage: "Someone else's commit" },
        { version: 12, versionId: "ver_mine012", commitMessage: "Add disclaimer" },
      ];
      mockGetPromptVersions.mockResolvedValue(listedVersions);

      const result = await handleUpdatePrompt({
        idOrHandle: "my-prompt",
        commitMessage: "Add disclaimer",
      });

      expect(result).toContain("ver_mine012");
      expect(result).not.toMatch(/could not be identified/i);
    });
  });

  describe("when the new version cannot be identified after a successful update", () => {
    /** @scenario "Signalling when the new version cannot be identified after a successful update" */
    it("states that version and deployment details are unavailable instead of silently omitting them", async () => {
      mockUpdatePrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
      });
      mockGetPrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        version: 9,
        versionId: "ver_stale009",
        commitMessage: "Some earlier commit",
        tags: [{ name: "latest", versionId: "ver_stale009" }],
      });
      mockGetPromptVersions.mockResolvedValue([
        { version: 9, versionId: "ver_stale009", commitMessage: "Some earlier commit" },
      ]);

      const result = await handleUpdatePrompt({
        idOrHandle: "my-prompt",
        commitMessage: "Unfindable commit",
      });

      expect(result).toContain("Prompt updated successfully!");
      expect(result).toMatch(/could not be identified/i);
      expect(result).toMatch(/version and deployment details are unavailable/i);
      expect(result).not.toContain("**Version**:");
      expect(result).not.toContain("**Deployed to**:");
      expect(result).not.toContain("**Deployment**:");
    });
  });

  describe("when tag assignment fails but the version was committed", () => {
    /** @scenario "Reporting a version as created but untagged when tag assignment fails and a matching version is found" */
    it("reports the version as created and untagged, with its versionId and the failed tag", async () => {
      const { LangWatchApiError } = await import("../langwatch-api.js");
      mockUpdatePrompt.mockRejectedValue(
        new LangWatchApiError("Tag assignment rejected", 422, "{}"),
      );
      mockGetPrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        version: 8,
        versionId: "ver_orphan8",
        commitMessage: "Risky change",
        tags: [{ name: "latest", versionId: "ver_orphan8" }],
      });

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
        new LangWatchApiError("Tag assignment rejected", 422, "{}"),
      );
      mockGetPrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
        version: 8,
        versionId: "ver_other08",
        commitMessage: "Unrelated commit",
        tags: [{ name: "latest", versionId: "ver_other08" }],
      });
      mockGetPromptVersions.mockResolvedValue([
        { version: 8, versionId: "ver_other08", commitMessage: "Unrelated commit" },
      ]);

      const result = await handleUpdatePrompt({
        idOrHandle: "my-prompt",
        commitMessage: "Risky change",
        tags: ["production"],
      });

      expect(result).toMatch(/fail/i);
      expect(result).not.toContain("ver_other08");
    });
  });

  describe("when the update succeeds but the confirmation read fails", () => {
    /** @scenario "Reporting success without details when the confirmation read fails" */
    it("still reports success with a note that details are unavailable, instead of rejecting", async () => {
      const { LangWatchApiError } = await import("../langwatch-api.js");
      mockUpdatePrompt.mockResolvedValue({
        id: "prompt_1",
        handle: "my-prompt",
      });
      mockGetPrompt.mockRejectedValue(new LangWatchApiError("boom", 500, "{}"));

      const result = await handleUpdatePrompt({
        idOrHandle: "my-prompt",
        commitMessage: "Safe change",
      });

      expect(result).toContain("Prompt updated successfully!");
      expect(result).toContain("prompt_1");
      expect(result).toContain("my-prompt");
      expect(result).toMatch(/confirmation read failed/i);
      expect(result).toMatch(/version and deployment details are unavailable/i);
      expect(result).not.toContain("**Version**:");
      expect(result).not.toContain("**Deployed to**:");
    });
  });

  describe("when tag assignment fails and the confirmation read also fails", () => {
    /** @scenario "Preserving the tag-assignment failure when the confirmation read fails" */
    it("reports the tag failure without claiming whether a version was created", async () => {
      const { LangWatchApiError } = await import("../langwatch-api.js");
      mockUpdatePrompt.mockRejectedValue(
        new LangWatchApiError("Tag assignment rejected", 422, "{}"),
      );
      mockGetPrompt.mockRejectedValue(new LangWatchApiError("boom", 500, "{}"));

      const result = await handleUpdatePrompt({
        idOrHandle: "my-prompt",
        commitMessage: "Risky change",
        tags: ["production"],
      });

      expect(result).toMatch(/fail/i);
      expect(result).toContain("production");
      expect(result).toMatch(/confirmation read failed/i);
      expect(result).not.toMatch(/version was created(?!\s+could not be confirmed)/i);
      expect(result).toMatch(/could not be confirmed/i);
    });
  });
});
