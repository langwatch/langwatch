import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  resolveReferences,
  applyApiKeyMode,
  wrapInEnvelope,
  compileSkill,
} from "../compile.js";
import path from "path";

const SKILLS_ROOT = path.resolve(__dirname, "../../");
const SKILL_DIR = path.join(SKILLS_ROOT, "create-agent");
const SHARED_DIR = path.join(SKILLS_ROOT, "_shared");

describe("parseFrontmatter()", () => {
  describe("when given valid SKILL.md content", () => {
    it("extracts the frontmatter fields", () => {
      const content = [
        "---",
        "name: test-skill",
        "description: A test skill",
        "license: MIT",
        "---",
        "",
        "# Body content",
      ].join("\n");

      const result = parseFrontmatter(content);

      expect(result.frontmatter.name).toBe("test-skill");
      expect(result.frontmatter.description).toBe("A test skill");
      expect(result.frontmatter.license).toBe("MIT");
    });

    it("returns the body without frontmatter", () => {
      const content = [
        "---",
        "name: test-skill",
        "description: A test skill",
        "---",
        "",
        "# Body content",
        "Some text here.",
      ].join("\n");

      const result = parseFrontmatter(content);

      expect(result.body).toBe("# Body content\nSome text here.");
    });
  });

  describe("when given content without frontmatter markers", () => {
    it("throws an error", () => {
      const content = "# No frontmatter here";

      expect(() => parseFrontmatter(content)).toThrow("Invalid SKILL.md format");
    });
  });
});

describe("resolveReferences()", () => {
  describe("when body contains _shared/ references", () => {
    it("inlines the content of the referenced file", () => {
      const body = "Some text.\n\nSee [MCP Setup](_shared/mcp-setup.md) for installation instructions.\n\nMore text.";

      const result = resolveReferences({ body, skillDir: SKILL_DIR, sharedDir: SHARED_DIR });

      expect(result).not.toContain("[MCP Setup](_shared/mcp-setup.md)");
      expect(result).toContain("# Installing the LangWatch MCP Server");
      expect(result).toContain("Some text.");
      expect(result).toContain("More text.");
    });
  });

  describe("when body contains references/ links", () => {
    it("inlines the content of the referenced file", () => {
      const body = "Read the guide:\n\n| Agno | [references/agno.md](references/agno.md) |";

      const result = resolveReferences({ body, skillDir: SKILL_DIR, sharedDir: SHARED_DIR });

      expect(result).not.toContain("[references/agno.md](references/agno.md)");
      expect(result).toContain("# Agno Framework Reference");
    });
  });

  describe("when body contains a reference to a nonexistent file", () => {
    it("leaves a bracketed placeholder", () => {
      const body = "See [Missing](_shared/nonexistent.md) for details.";

      const result = resolveReferences({ body, skillDir: SKILL_DIR, sharedDir: SHARED_DIR });

      expect(result).toContain("[Unresolved reference: _shared/nonexistent.md]");
    });
  });

  describe("when body contains cross-references within shared files", () => {
    it("resolves nested references from shared files", () => {
      // api-key-setup.md references mcp-setup.md via a relative link
      const body = "Get your key: see [API Key Setup](_shared/api-key-setup.md).";

      const result = resolveReferences({ body, skillDir: SKILL_DIR, sharedDir: SHARED_DIR });

      expect(result).toContain("# LangWatch API Key Setup");
    });

    it("removes relative cross-references within inlined shared content", () => {
      const body = "Get your key: see [API Key Setup](_shared/api-key-setup.md).";

      const result = resolveReferences({ body, skillDir: SKILL_DIR, sharedDir: SHARED_DIR });

      // The inlined api-key-setup.md has [MCP Setup](mcp-setup.md) which should be resolved
      expect(result).not.toMatch(/\[[^\]]+\]\([^)]*\.md\)/);
    });
  });
});

describe("applyApiKeyMode()", () => {
  describe("when mode is platform", () => {
    it("replaces YOUR_API_KEY with the template placeholder", () => {
      const content = 'claude mcp add langwatch -- npx -y @langwatch/mcp-server --apiKey YOUR_API_KEY';

      const result = applyApiKeyMode({ content, mode: "platform" });

      expect(result).toContain("{{LANGWATCH_API_KEY}}");
      expect(result).not.toContain("YOUR_API_KEY");
    });

    it("replaces your-langwatch-api-key placeholders", () => {
      const content = "LANGWATCH_API_KEY=your-langwatch-api-key";

      const result = applyApiKeyMode({ content, mode: "platform" });

      expect(result).toContain("{{LANGWATCH_API_KEY}}");
    });
  });

  describe("when mode is docs", () => {
    it("replaces YOUR_API_KEY with an ask-user instruction", () => {
      const content = "Use --apiKey YOUR_API_KEY for setup.";

      const result = applyApiKeyMode({ content, mode: "docs" });

      expect(result).not.toContain("YOUR_API_KEY");
      expect(result).toContain("ASK_USER_FOR_API_KEY");
    });

    it("includes the authorize URL", () => {
      const content = "Some content with YOUR_API_KEY placeholder.";

      const result = applyApiKeyMode({ content, mode: "docs" });

      expect(result).toContain("https://app.langwatch.ai/authorize");
    });
  });
});

describe("wrapInEnvelope()", () => {
  describe("when mode is platform", () => {
    it("adds a system instruction header", () => {
      const result = wrapInEnvelope({ content: "body content", mode: "platform" });

      expect(result).toContain("body content");
      expect(result).toMatch(/^You are/); // starts with system instruction
    });
  });

  describe("when mode is docs", () => {
    it("includes an instruction to ask for the API key", () => {
      const result = wrapInEnvelope({ content: "body content", mode: "docs" });

      expect(result).toContain("https://app.langwatch.ai/authorize");
      expect(result).toContain("body content");
    });
  });
});

describe("compileSkill()", () => {
  describe("when compiling create-agent in platform mode", () => {
    it("produces self-contained output with no unresolved file references", () => {
      const result = compileSkill({ skillName: "create-agent", mode: "platform" });

      // No unresolved markdown links to local files
      const unresolvedLinks = result.match(/\[[^\]]+\]\((?:_shared|references)\/[^)]+\)/g);
      expect(unresolvedLinks).toBeNull();
    });

    it("contains the LANGWATCH_API_KEY template placeholder", () => {
      const result = compileSkill({ skillName: "create-agent", mode: "platform" });

      expect(result).toContain("{{LANGWATCH_API_KEY}}");
    });

    it("keeps framework selection interactive", () => {
      const result = compileSkill({ skillName: "create-agent", mode: "platform" });

      // Should still have the framework table for user to choose
      expect(result).toContain("Agno");
      expect(result).toContain("Mastra");
      expect(result).toContain("Vercel AI SDK");
      expect(result).toContain("LangGraph");
      expect(result).toContain("Google ADK");
    });

    it("includes inlined shared content", () => {
      const result = compileSkill({ skillName: "create-agent", mode: "platform" });

      // Should have the inlined MCP setup content
      expect(result).toContain("Installing the LangWatch MCP Server");
    });

    it("includes inlined framework reference content", () => {
      const result = compileSkill({ skillName: "create-agent", mode: "platform" });

      // Should have all framework references inlined
      expect(result).toContain("Agno Framework Reference");
      expect(result).toContain("Mastra Framework Reference");
    });
  });

  describe("when compiling create-agent in docs mode", () => {
    it("instructs the agent to ask the user for their API key", () => {
      const result = compileSkill({ skillName: "create-agent", mode: "docs" });

      expect(result).toContain("https://app.langwatch.ai/authorize");
    });

    it("produces self-contained output with no unresolved file references", () => {
      const result = compileSkill({ skillName: "create-agent", mode: "docs" });

      const unresolvedLinks = result.match(/\[[^\]]+\]\((?:_shared|references)\/[^)]+\)/g);
      expect(unresolvedLinks).toBeNull();
    });
  });

  describe("when skill does not exist", () => {
    it("throws an error", () => {
      expect(() => compileSkill({ skillName: "nonexistent", mode: "platform" })).toThrow(
        "Skill not found: nonexistent"
      );
    });
  });
});
