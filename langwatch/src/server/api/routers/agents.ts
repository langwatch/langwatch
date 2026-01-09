import { z } from "zod";
import { nanoid } from "nanoid";
import { JSONPath } from "jsonpath-plus";
import { AgentService } from "../../agents/agent.service";
import {
  agentTypeSchema,
  type AgentType,
  type AgentComponentConfig,
} from "../../agents/agent.repository";
import {
  signatureComponentSchema,
  codeComponentSchema,
  customComponentSchema,
  httpComponentSchema,
} from "~/optimization_studio/types/dsl";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Get config schema based on agent type for validation
 */
const getConfigInputSchema = (type: AgentType) => {
  switch (type) {
    case "signature":
      return signatureComponentSchema;
    case "code":
      return codeComponentSchema;
    case "workflow":
      return customComponentSchema;
    case "http":
      return httpComponentSchema;
  }
};

/**
 * Agent Router - Manages agent CRUD operations
 *
 * Agents are reusable LLM components that can be:
 * - signature: LLM-based with prompt configuration (matches LlmPromptConfigComponent)
 * - code: Python code executor (matches Code component with code parameter)
 * - workflow: Reference to an existing workflow (matches Custom component)
 * - http: External API caller with configurable URL, headers, auth, and body template
 *
 * Config is stored as DSL-compatible node data for direct execution.
 */
export const agentsRouter = createTRPCRouter({
  /**
   * Gets all agents for a project
   * Returns typed agents with parsed config matching DSL node data
   */
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("evaluations:view"))
    .query(async ({ ctx, input }) => {
      const agentService = AgentService.create(ctx.prisma);
      return await agentService.getAll({ projectId: input.projectId });
    }),

  /**
   * Gets a single agent by ID
   * Returns typed agent with parsed config matching DSL node data
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("evaluations:view"))
    .query(async ({ ctx, input }) => {
      const agentService = AgentService.create(ctx.prisma);
      return await agentService.getById({
        id: input.id,
        projectId: input.projectId,
      });
    }),

  /**
   * Creates a new agent
   * Validates config matches the specified type's DSL schema
   */
  create: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string(),
          name: z.string().min(1).max(255),
          type: agentTypeSchema,
          // Accept any object, validation happens in refine
          config: z.record(z.unknown()),
          workflowId: z.string().optional(),
        })
        .refine(
          (data) => {
            // Validate config matches the specified type's DSL schema
            const schema = getConfigInputSchema(data.type);
            const result = schema.safeParse(data.config);
            return result.success;
          },
          {
            message:
              "Config does not match the specified agent type's DSL schema",
            path: ["config"],
          },
        ),
    )
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ ctx, input }) => {
      const agentService = AgentService.create(ctx.prisma);
      // Config is validated by the refine above, safe to cast
      return await agentService.create({
        id: `agent_${nanoid()}`,
        projectId: input.projectId,
        name: input.name,
        type: input.type,
        config: input.config as AgentComponentConfig,
        workflowId: input.workflowId,
      });
    }),

  /**
   * Updates an existing agent
   * Validates config if provided
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        projectId: z.string(),
        name: z.string().min(1).max(255).optional(),
        type: agentTypeSchema.optional(),
        // Accept any object, validation happens in repository
        config: z.record(z.unknown()).optional(),
        workflowId: z.string().nullable().optional(),
      }),
    )
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ ctx, input }) => {
      const agentService = AgentService.create(ctx.prisma);

      // Repository will validate config against the type's DSL schema
      return await agentService.update({
        id: input.id,
        projectId: input.projectId,
        data: {
          ...(input.name && { name: input.name }),
          ...(input.type && { type: input.type }),
          ...(input.config && { config: input.config as AgentComponentConfig }),
          ...(input.workflowId !== undefined && {
            workflowId: input.workflowId,
          }),
        },
      });
    }),

  /**
   * Soft deletes an agent
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string(), projectId: z.string() }))
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ ctx, input }) => {
      const agentService = AgentService.create(ctx.prisma);
      return await agentService.softDelete({
        id: input.id,
        projectId: input.projectId,
      });
    }),

  /**
   * Tests an HTTP agent configuration
   * Makes a real HTTP request and returns the response
   */
  testHttp: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        url: z.string().url(),
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        headers: z
          .array(z.object({ key: z.string(), value: z.string() }))
          .optional(),
        auth: z
          .object({
            type: z.enum(["none", "bearer", "api_key", "basic"]),
            token: z.string().optional(),
            headerName: z.string().optional(),
            username: z.string().optional(),
            password: z.string().optional(),
          })
          .optional(),
        body: z.string(),
        outputPath: z.string().optional(),
      })
    )
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ input }) => {
      const { url, method, headers, auth, body, outputPath } = input;

      // Build request headers
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Add custom headers
      if (headers) {
        for (const header of headers) {
          requestHeaders[header.key] = header.value;
        }
      }

      // Add auth headers
      if (auth) {
        switch (auth.type) {
          case "bearer":
            if (auth.token) {
              requestHeaders["Authorization"] = `Bearer ${auth.token}`;
            }
            break;
          case "api_key":
            if (auth.headerName && auth.token) {
              requestHeaders[auth.headerName] = auth.token;
            }
            break;
          case "basic":
            if (auth.username && auth.password) {
              const encoded = Buffer.from(
                `${auth.username}:${auth.password}`
              ).toString("base64");
              requestHeaders["Authorization"] = `Basic ${encoded}`;
            }
            break;
        }
      }

      try {
        // Parse body to validate JSON
        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(body);
        } catch {
          return {
            success: false,
            error: "Invalid JSON in request body",
          };
        }

        // Make the HTTP request
        const startTime = Date.now();
        const response = await fetch(url, {
          method,
          headers: requestHeaders,
          body: method !== "GET" ? JSON.stringify(parsedBody) : undefined,
        });
        const duration = Date.now() - startTime;

        // Parse response
        let responseData: unknown;
        const contentType = response.headers.get("content-type");
        if (contentType?.includes("application/json")) {
          responseData = await response.json();
        } else {
          responseData = await response.text();
        }

        // Extract output if path provided
        let extractedOutput: string | undefined;
        if (outputPath && outputPath.trim() && responseData) {
          try {
            const result = JSONPath({ path: outputPath, json: responseData });
            if (result && result.length > 0) {
              extractedOutput =
                typeof result[0] === "string"
                  ? result[0]
                  : JSON.stringify(result[0]);
            }
          } catch {
            // JSONPath extraction failed, leave extractedOutput undefined
          }
        }

        if (!response.ok) {
          return {
            success: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
            response: responseData,
            duration,
          };
        }

        return {
          success: true,
          response: responseData,
          extractedOutput,
          duration,
          status: response.status,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Request failed",
        };
      }
    }),
});
