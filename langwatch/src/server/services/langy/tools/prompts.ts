import { z } from "zod";
import { defineLangyTool } from "../defineLangyTool";
import type { LangyConversationContext } from "./types";

const promptErrorSchema = z.object({ error: z.string() });

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

export function makeListPrompts(ctx: LangyConversationContext) {
  return defineLangyTool({
    name: "list_prompts",
    description:
      "Lists the prompts defined in the caller's project. Returns handle, name, model, and a short preview.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      items: z.array(
        z.object({
          id: z.string(),
          handle: z.string(),
          name: z.string(),
          model: z.string().nullable().optional(),
          scope: z.string().nullable().optional(),
        }),
      ),
    }),
    execute: async () => {
      const prompts = await ctx.promptService.getAllPrompts({
        projectId: ctx.projectId,
        version: "latest",
      });
      for (const p of prompts as Array<Record<string, unknown>>) {
        ctx.seenIds.record("prompt_id", p.id as string);
        ctx.seenIds.record("prompt_handle", p.handle as string);
      }
      return {
        items: prompts.map((p: Record<string, unknown>) => ({
          id: p.id as string,
          handle: p.handle as string,
          name: (p.name ?? p.handle) as string,
          model: p.model as string | null | undefined,
          scope: p.scope as string | null | undefined,
        })),
      };
    },
  });
}

export function makeGetPromptDetails(ctx: LangyConversationContext) {
  return defineLangyTool({
    name: "get_prompt_details",
    description:
      "Fetch the full config for a single prompt by handle or id: model, temperature, maxTokens, message templates, and declared inputs/outputs.",
    inputSchema: z.object({
      idOrHandle: z
        .string()
        .describe("The prompt id or handle, as returned by list_prompts."),
    }),
    outputSchema: z.union([
      promptErrorSchema,
      z.object({
        id: z.string(),
        handle: z.string(),
        scope: z.unknown(),
        model: z.unknown(),
        temperature: z.unknown(),
        maxTokens: z.unknown(),
        messages: z.unknown(),
        inputs: z.unknown(),
        outputs: z.unknown(),
        version: z.unknown(),
      }),
    ]),
    execute: async ({ idOrHandle }) => {
      const prompt = await ctx.promptService.getPromptByIdOrHandle({
        idOrHandle,
        projectId: ctx.projectId,
      });
      if (!prompt) {
        return { error: `No prompt found with id or handle '${idOrHandle}'.` };
      }
      const p = prompt as Record<string, unknown>;
      return {
        id: p.id as string,
        handle: p.handle as string,
        scope: p.scope,
        model: p.model,
        temperature: p.temperature,
        maxTokens: p.maxTokens,
        messages: p.messages,
        inputs: p.inputs,
        outputs: p.outputs,
        version: p.version,
      };
    },
  });
}

export function makeSearchPrompts(ctx: LangyConversationContext) {
  return defineLangyTool({
    name: "search_prompts",
    description:
      "Search prompts in this project by handle/name keyword. Use when looking for an existing prompt to reference or update.",
    inputSchema: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(20).default(10),
    }),
    outputSchema: z.object({
      items: z.array(
        z.object({
          id: z.string(),
          handle: z.string(),
          name: z.string(),
        }),
      ),
    }),
    execute: async ({ query, limit }) => {
      const rows = await ctx.promptService.searchByKeyword({
        projectId: ctx.projectId,
        query,
        limit,
      });
      for (const r of rows) {
        ctx.seenIds.record("prompt_id", r.id);
        ctx.seenIds.record("prompt_handle", r.handle);
      }
      return {
        items: rows.map((r) => ({
          id: r.id,
          handle: r.handle,
          name: r.name ?? r.handle,
        })),
      };
    },
  });
}

const promptCreateProposalSchema = z.object({
  langyProposal: z.literal(true),
  kind: z.literal("prompts.create"),
  summary: z.string(),
  rationale: z.string(),
  payload: z.object({
    handle: z.string(),
    messages: z.array(messageSchema),
    model: z.string().optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
  }),
});

export function makeProposeCreatePrompt(_ctx: LangyConversationContext) {
  return defineLangyTool({
    name: "propose_create_prompt",
    description:
      "Propose creating a new prompt in the project. Returns a card the user approves to commit. The handle must be unique within the project; use kebab-case or snake_case.",
    inputSchema: z.object({
      handle: z
        .string()
        .min(1)
        .max(80)
        .describe(
          "Unique, URL-safe prompt handle (e.g. 'rag-qa', 'support-triage').",
        ),
      messages: z
        .array(messageSchema)
        .min(1)
        .describe("Chat-style message templates that define the prompt."),
      model: z
        .string()
        .optional()
        .describe(
          "Optional model override (e.g. 'openai/gpt-4.1-mini'). Omit to fall back to the project default.",
        ),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().positive().optional(),
      rationale: z
        .string()
        .describe(
          "One short sentence explaining why this prompt fits the user's goal.",
        ),
    }),
    outputSchema: promptCreateProposalSchema,
    execute: async ({
      handle,
      messages,
      model,
      temperature,
      maxTokens,
      rationale,
    }) => {
      return {
        langyProposal: true as const,
        kind: "prompts.create" as const,
        summary: `Create prompt "${handle}"`,
        rationale,
        payload: {
          handle,
          messages,
          model,
          temperature,
          maxTokens,
        },
      };
    },
  });
}

const promptUpdateProposalSchema = z.object({
  langyProposal: z.literal(true),
  kind: z.literal("prompts.update"),
  summary: z.string(),
  rationale: z.string(),
  payload: z.object({
    id: z.string(),
    commitMessage: z.string(),
    messages: z.array(messageSchema).optional(),
    model: z.string().optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
  }),
});

export function makeProposeUpdatePrompt(ctx: LangyConversationContext) {
  return defineLangyTool({
    name: "propose_update_prompt",
    description:
      "Propose updating an existing prompt by creating a new version. A commitMessage is required. Call get_prompt_details first so you only send fields you actually want to change.",
    inputSchema: z.object({
      id: z
        .string()
        .describe("The prompt id (not handle), as returned by list_prompts."),
      commitMessage: z
        .string()
        .min(1)
        .describe("Short description of what this revision changes."),
      messages: z.array(messageSchema).optional(),
      model: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().positive().optional(),
      rationale: z.string(),
    }),
    outputSchema: z.union([promptErrorSchema, promptUpdateProposalSchema]),
    execute: async ({
      id,
      commitMessage,
      messages,
      model,
      temperature,
      maxTokens,
      rationale,
    }) => {
      if (!ctx.seenIds.hasAny(["prompt_id", "prompt_handle"], id)) {
        return {
          error: `Prompt '${id}' was not surfaced by list_prompts in this conversation. Call list_prompts first and reference one of those id/handle values.`,
        };
      }
      const existing = await ctx.promptService.getPromptByIdOrHandle({
        idOrHandle: id,
        projectId: ctx.projectId,
      });
      if (!existing) {
        return { error: `No prompt found with id '${id}'.` };
      }
      return {
        langyProposal: true as const,
        kind: "prompts.update" as const,
        summary: `Update prompt "${(existing as { handle?: string }).handle ?? id}"`,
        rationale,
        payload: {
          id,
          commitMessage,
          messages,
          model,
          temperature,
          maxTokens,
        },
      };
    },
  });
}
