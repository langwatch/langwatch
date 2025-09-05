import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  getSetupGuide,
  getIntegrationExample,
  getConceptsExplanation,
  getTroubleshootingHelp,
  getEvaluationSetup,
  getAnnotationGuide,
} from "./langwatch-setup-assistant.js";
import packageJson from "../package.json" assert { type: "json" };

function loadAndValidateArgs(): { debug?: boolean } {
  const argv = yargs(hideBin(process.argv))
    .option("debug", {
      type: "boolean",
      description: "Enable debug logging",
      default: false,
    })
    .help()
    .alias("help", "h")
    .parseSync();

  return {
    debug: argv.debug,
  };
}

const { debug } = loadAndValidateArgs();

const transport = new StdioServerTransport();
const server = new McpServer({
  name: "LangWatch Setup Assistant",
  version: packageJson.version,
});

if (debug) {
  console.error("Debug mode enabled");
}

// Tool: Get setup guide for a specific language/framework
server.tool(
  "get_setup_guide",
  {
    language: z
      .enum(["python", "typescript", "javascript", "rest_api"])
      .optional(),
    framework: z.string().optional(),
  },
  async ({ language, framework }) => {
    const guide = await getSetupGuide(language, framework);

    return {
      content: [
        {
          type: "text",
          text: guide,
        },
      ],
    };
  }
);

// Tool: Get integration examples with code snippets
server.tool(
  "get_integration_example",
  {
    language: z.enum(["python", "typescript", "javascript"]),
    integration_type: z
      .enum(["basic", "openai", "anthropic", "custom_llm", "evaluation"])
      .optional(),
  },
  async ({ language, integration_type = "basic" }) => {
    const example = await getIntegrationExample(language, integration_type);

    return {
      content: [
        {
          type: "text",
          text: example,
        },
      ],
    };
  }
);

// Tool: Explain LangWatch concepts
server.tool(
  "explain_concepts",
  {
    concept: z
      .enum([
        "traces",
        "spans",
        "threads",
        "user_id",
        "customer_id",
        "labels",
        "all",
      ])
      .optional(),
  },
  async ({ concept = "all" }) => {
    const explanation = await getConceptsExplanation(concept);

    return {
      content: [
        {
          type: "text",
          text: explanation,
        },
      ],
    };
  }
);

// Tool: Get troubleshooting help
server.tool(
  "get_troubleshooting_help",
  {
    issue: z
      .enum([
        "no_traces_appearing",
        "authentication_error",
        "performance_impact",
        "missing_data",
        "installation_error",
        "general",
      ])
      .optional(),
  },
  async ({ issue = "general" }) => {
    const help = await getTroubleshootingHelp(issue);

    return {
      content: [
        {
          type: "text",
          text: help,
        },
      ],
    };
  }
);

// Tool: Get evaluation setup guide
server.tool(
  "get_evaluation_setup",
  {
    evaluator_type: z
      .enum(["custom", "langevals", "built_in", "all"])
      .optional(),
  },
  async ({ evaluator_type = "all" }) => {
    const setup = await getEvaluationSetup(evaluator_type);

    return {
      content: [
        {
          type: "text",
          text: setup,
        },
      ],
    };
  }
);

// Tool: Get annotation and collaboration guide
server.tool(
  "get_annotation_guide",
  {
    feature: z
      .enum(["annotations", "queues", "scoring", "collaboration", "all"])
      .optional(),
  },
  async ({ feature = "all" }) => {
    const guide = await getAnnotationGuide(feature);

    return {
      content: [
        {
          type: "text",
          text: guide,
        },
      ],
    };
  }
);

await server.connect(transport);

if (debug) {
  console.error("LangWatch Setup Assistant MCP Server is running...");
}
