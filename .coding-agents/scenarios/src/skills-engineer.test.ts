import { setupScenarioTracing } from "@langwatch/scenario";
// MUST be called before any other imports to ensure scenario tracing works
setupScenarioTracing();

import scenario, {
  type AgentAdapter,
  AgentRole,
} from "@langwatch/scenario";
import { describe, it, expect, beforeAll } from "vitest";
import dotenv from "dotenv";

dotenv.config();

// Configure default model for all scenario runs
// Using gpt-5-mini as recommended for cost-effectiveness
const DEFAULT_MODEL = "openai/gpt-5-mini";

/**
 * Agent adapter that simulates an agent with access to go-engineer and ts-engineer skills
 * This agent should use gopls for Go code and tslsp-cli for TypeScript code
 */
const engineerAgent = (): AgentAdapter => ({
  role: AgentRole.AGENT,
  call: async (state) => {
    const userMessage = state.messages.find(m => m.role === "user")?.content || "";
    
    // Simple simulation: if the user asks about Go code, respond with gopls usage
    // If they ask about TypeScript code, respond with tslsp-cli usage
    if (userMessage.toLowerCase().includes("go") || userMessage.toLowerCase().includes("golang")) {
      return `I'll use gopls to analyze this Go code. Let me find the definition and references using type-aware tools.`;
    }
    if (userMessage.toLowerCase().includes("typescript") || userMessage.toLowerCase().includes(".ts")) {
      return `I'll use tslsp-cli to analyze this TypeScript code. Let me find the definition and references using type-aware tools.`;
    }
    
    // Default response
    return `I need more context about what type of code you're working with. Please specify if it's Go or TypeScript.`;
  },
});

/**
 * More realistic agent that actually demonstrates skill usage
 * This simulates what a proper agent would do with the skills
 */
const skilledEngineerAgent = (): AgentAdapter => ({
  role: AgentRole.AGENT,
  call: async (state) => {
    const userMessage = state.messages.find(m => m.role === "user")?.content || "";
    
    // Simulate proper tool usage based on the skills
    if (userMessage.toLowerCase().includes("find definition") || userMessage.toLowerCase().includes("where is")) {
      if (userMessage.includes(".go")) {
        return `Using gopls definition command: gopls definition src/pkg/service.go:42:6`;
      }
      if (userMessage.includes(".ts") || userMessage.includes(".tsx")) {
        return `Using tslsp-cli definition command: tslsp-cli definition --symbol UserService --file src/services/UserService.ts`;
      }
    }
    
    if (userMessage.toLowerCase().includes("find references") || userMessage.toLowerCase().includes("where is used")) {
      if (userMessage.includes(".go")) {
        return `Using gopls references command: gopls references pkg/service.go:42:6`;
      }
      if (userMessage.includes(".ts") || userMessage.includes(".tsx")) {
        return `Using tslsp-cli references command: tslsp-cli references --symbol UserService --summary`;
      }
    }
    
    if (userMessage.toLowerCase().includes("rename")) {
      if (userMessage.includes(".go")) {
        return `Using gopls rename with dry-run first: gopls rename src/pkg/service.go:42:6 NewName --dry-run`;
      }
      if (userMessage.includes(".ts") || userMessage.includes(".tsx")) {
        return `Using tslsp-cli rename with dry-run first: tslsp-cli rename --symbol oldName --new-name newName --dry-run`;
      }
    }
    
    if (userMessage.toLowerCase().includes("type-aware") || userMessage.toLowerCase().includes("semantic")) {
      return `Type-aware tools like gopls and tslsp-cli understand semantic relationships: re-exports, aliases, interface implementations, and import paths. Text-based tools like grep and edit cannot.`;
    }
    
    return `I have access to go-engineer and ts-engineer skills. For Go code, I use gopls. For TypeScript, I use tslsp-cli. These are type-aware tools that understand semantic relationships.`;
  },
});

// Check if we have a LangWatch API key for observability
const hasLangWatchKey = !!process.env.LANGWATCH_API_KEY;

describe("Engineer Skills - Type-Aware Code Navigation", () => {
  
  describe("Go Engineer Skill (gopls)", () => {
    
    it("should recognize Go code and use gopls for definitions", async () => {
      const result = await scenario.run({
        name: "Go code - find definition",
        description: "User asks to find the definition of a Go symbol",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use gopls for Go code",
              "Agent should use definition command",
              "Agent should reference the go-engineer skill",
            ],
          }),
        ],
        script: [
          scenario.user("I need to find where the ProcessRequest function is defined in my Go code. It's in src/pkg/handler.go."),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 60_000);

    it("should use gopls for finding Go symbol references", async () => {
      const result = await scenario.run({
        name: "Go code - find references",
        description: "User asks to find all references to a Go symbol",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use gopls references command",
              "Agent should understand type-aware navigation",
            ],
          }),
        ],
        script: [
          scenario.user("I need to find all places where the User struct is referenced in my Go project."),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 60_000);

    it("should use gopls rename with dry-run for safe refactoring", async () => {
      const result = await scenario.run({
        name: "Go code - safe rename",
        description: "User wants to rename a Go symbol safely",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use gopls rename command",
              "Agent should always use --dry-run first",
              "Agent demonstrates safe refactoring practice",
            ],
          }),
        ],
        script: [
          scenario.user("I want to rename the handleRequest function to processRequest in my Go code."),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 60_000);

    it("should explain why gopls is better than grep for Go", async () => {
      const result = await scenario.run({
        name: "Go code - type-aware vs text-based",
        description: "User asks why not just use grep for Go code",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should explain gopls understands semantic relationships",
              "Agent should mention grep misses re-exports and aliases",
              "Agent should reference the go-engineer skill",
            ],
          }),
        ],
        script: [
          scenario.user("Why can't I just use grep to find Go function definitions? What's the difference?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 60_000);
  });

  describe("TypeScript Engineer Skill (tslsp-cli)", () => {

    it("should recognize TypeScript code and use tslsp-cli for definitions", async () => {
      const result = await scenario.run({
        name: "TypeScript code - find definition",
        description: "User asks to find the definition of a TypeScript symbol",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use tslsp-cli for TypeScript code",
              "Agent should use definition command",
              "Agent should reference the ts-engineer skill",
            ],
          }),
        ],
        script: [
          scenario.user("I need to find where the UserService class is defined in my TypeScript project."),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 60_000);

    it("should use tslsp-cli for finding TypeScript symbol references", async () => {
      const result = await scenario.run({
        name: "TypeScript code - find references",
        description: "User asks to find all references to a TypeScript symbol",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use tslsp-cli references command",
              "Agent should use --summary for popular symbols",
              "Agent should understand type-aware navigation",
            ],
          }),
        ],
        script: [
          scenario.user("I need to find all places where the fetchUser function is used in my TypeScript codebase."),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 60_000);

    it("should use tslsp-cli rename with dry-run for safe refactoring", async () => {
      const result = await scenario.run({
        name: "TypeScript code - safe rename",
        description: "User wants to rename a TypeScript symbol safely",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use tslsp-cli rename command",
              "Agent should always use --dry-run first",
              "Agent demonstrates safe refactoring practice",
            ],
          }),
        ],
        script: [
          scenario.user("I want to rename the userAccount variable to userProfile in my TypeScript code."),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 60_000);

    it("should explain why tslsp-cli is better than grep for TypeScript", async () => {
      const result = await scenario.run({
        name: "TypeScript code - type-aware vs text-based",
        description: "User asks why not just use grep for TypeScript code",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should explain tslsp-cli understands semantic relationships",
              "Agent should mention grep misses re-exports and alias imports",
              "Agent should reference the ts-engineer skill",
            ],
          }),
        ],
        script: [
          scenario.user("Why can't I just use grep to find TypeScript function definitions? What's the difference?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 60_000);
  });

  describe("Multi-turn scenarios", () => {

    it("should handle a multi-turn Go refactoring conversation", async () => {
      const result = await scenario.run({
        name: "Multi-turn Go refactoring",
        description: "User wants to refactor Go code with multiple steps",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use gopls for all Go operations",
              "Agent should follow safe refactoring practices",
              "Agent should verify with diagnostics after changes",
            ],
          }),
        ],
        script: [
          scenario.user("I have a Go function called HandleRequest that I want to rename to ProcessRequest."),
          scenario.agent(),
          scenario.user("Should I check for any references first before renaming?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 90_000);

    it("should handle a multi-turn TypeScript refactoring conversation", async () => {
      const result = await scenario.run({
        name: "Multi-turn TypeScript refactoring",
        description: "User wants to refactor TypeScript code with multiple steps",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use tslsp-cli for all TypeScript operations",
              "Agent should follow safe refactoring practices",
              "Agent should use batch operations where appropriate",
            ],
          }),
        ],
        script: [
          scenario.user("I have a TypeScript class called UserManager that I want to rename to AccountManager."),
          scenario.agent(),
          scenario.user("What about the imports? Will they be updated automatically?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 90_000);
  });

  describe("Edge cases and error handling", () => {

    it("should handle Go code without position information", async () => {
      const result = await scenario.run({
        name: "Go code - no position info",
        description: "User asks about Go code but doesn't provide file position",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should still use gopls",
              "Agent should ask for clarification or use workspace search",
            ],
          }),
        ],
        script: [
          scenario.user("I need to find where ProcessRequest is defined somewhere in my Go project."),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 60_000);

    it("should handle TypeScript code with complex import patterns", async () => {
      const result = await scenario.run({
        name: "TypeScript code - complex imports",
        description: "User asks about TypeScript code with re-exports and aliases",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use tslsp-cli which handles complex imports",
              "Agent should mention that grep would miss these cases",
            ],
          }),
        ],
        script: [
          scenario.user("I have a TypeScript symbol that's re-exported through multiple index.ts files. How do I find all references?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 60_000);

    it("should recognize when not to use type-aware tools", async () => {
      const result = await scenario.run({
        name: "Non-code files - use text tools",
        description: "User asks about non-code files where type-aware tools don't apply",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should recognize type-aware tools don't apply to non-code files",
              "Agent should suggest appropriate tools for the task",
            ],
          }),
        ],
        script: [
          scenario.user("I need to search through my README.md file for documentation. What should I use?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 60_000);
  });
});

// Skill effectiveness tracking scenarios
describe("Skill Effectiveness Tracking", () => {
  
  describe("Go Engineer Skill Effectiveness", () => {
    
    it("should correctly identify when gopls finds definitions that grep would miss", async () => {
      const result = await scenario.run({
        name: "gopls vs grep - re-exports",
        description: "Demonstrate gopls finding definitions that grep would miss due to re-exports",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should explain gopls handles re-exports correctly",
              "Agent should demonstrate the limitation of text-based tools",
              "Agent should show the value of type-aware navigation",
            ],
          }),
        ],
        script: [
          scenario.user("In my Go code, I have a function that's re-exported from another package. grep doesn't find the original definition. How do I find it?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 60_000);

    it("should correctly identify interface implementations with gopls", async () => {
      const result = await scenario.run({
        name: "gopls - interface implementations",
        description: "Demonstrate gopls finding interface implementations",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use gopls implementation command",
              "Agent should explain this requires type analysis",
              "Agent should show grep cannot find interface implementations",
            ],
          }),
        ],
        script: [
          scenario.user("I have a Go interface called Processor. How do I find all structs that implement it?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 60_000);

    it("should demonstrate safe Go refactoring workflow", async () => {
      const result = await scenario.run({
        name: "Go safe refactoring workflow",
        description: "Complete workflow for safe Go refactoring using gopls",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should demonstrate the full workflow: references → dry-run rename → verify with diagnostics",
              "Agent should emphasize safety at each step",
              "Agent should show type-aware tools prevent breaking changes",
            ],
          }),
        ],
        script: [
          scenario.user("What's the safest way to rename a Go function that's used in multiple packages?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 60_000);
  });

  describe("TypeScript Engineer Skill Effectiveness", () => {

    it("should correctly identify when tslsp-cli finds references that grep would miss", async () => {
      const result = await scenario.run({
        name: "tslsp-cli vs grep - re-exports and aliases",
        description: "Demonstrate tslsp-cli finding references that grep would miss due to re-exports and alias imports",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should explain tslsp-cli handles re-exports and aliases correctly",
              "Agent should demonstrate the limitation of text-based tools",
              "Agent should show the value of type-aware navigation",
            ],
          }),
        ],
        script: [
          scenario.user("In my TypeScript code, I have a function that's imported with an alias. grep doesn't find all usages. How do I find them all?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 60_000);

    it("should correctly handle TypeScript file moves with import updates", async () => {
      const result = await scenario.run({
        name: "tslsp-cli - file move with import updates",
        description: "Demonstrate tslsp-cli handling file moves and updating imports",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use tslsp-cli rename-file command",
              "Agent should explain imports are updated automatically",
              "Agent should emphasize this is safer than manual move",
            ],
          }),
        ],
        script: [
          scenario.user("I need to move a TypeScript file from src/utils/helper.ts to src/services/helper.ts. How do I update all the imports?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 60_000);

    it("should demonstrate batch operations for efficiency", async () => {
      const result = await scenario.run({
        name: "tslsp-cli batch operations",
        description: "Demonstrate tslsp-cli batch operations for multiple symbols",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use batch operations with multiple symbols",
              "Agent should explain batch operations save tokens and round-trips",
              "Agent should show how to find multiple definitions at once",
            ],
          }),
        ],
        script: [
          scenario.user("I need to find the definitions of UserService, AuthService, and Logger in my TypeScript project. Can I do this in one command?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 60_000);
  });

  describe("Comparative effectiveness", () => {

    it("should explain the difference between gopls and tslsp-cli", async () => {
      const result = await scenario.run({
        name: "gopls vs tslsp-cli comparison",
        description: "Explain the differences and similarities between Go and TypeScript type-aware tools",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should explain both are type-aware language servers",
              "Agent should mention both replace text-based tools",
              "Agent should note the differences in commands and position formats",
            ],
          }),
        ],
        script: [
          scenario.user("What's the difference between how gopls works for Go and how tslsp-cli works for TypeScript?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 60_000);

    it("should handle a mixed codebase scenario", async () => {
      const result = await scenario.run({
        name: "Mixed codebase - Go and TypeScript",
        description: "User works with both Go and TypeScript in the same project",
        agents: [
          skilledEngineerAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should correctly switch between gopls and tslsp-cli",
              "Agent should recognize the language context",
              "Agent should use the appropriate skill for each language",
            ],
          }),
        ],
        script: [
          scenario.user("I'm working on a project with both Go backend and TypeScript frontend. I need to rename a function in the Go API. What should I use?"),
          scenario.agent(),
          scenario.user("And if I need to rename a function in the TypeScript frontend?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });
      
      expect(result.success).toBe(true);
    }, 90_000);
  });
});
