import { z } from "zod";
import { agentInputBindingSchema } from "../fields";
import { baseAgentConfigSchema } from "./base";

export const httpHeaderSchema = z.object({
  key: z.string(),
  value: z.string(),
});

export const httpAuthSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer"), token: z.string() }),
  z.object({
    type: z.literal("api_key"),
    header: z.string(),
    value: z.string(),
  }),
  z.object({
    type: z.literal("basic"),
    username: z.string(),
    password: z.string(),
  }),
]);

export const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;

export const httpAgentConfigSchema = baseAgentConfigSchema.extend({
  url: z.string().min(1, "URL is required"),
  method: z.enum(HTTP_METHODS).default("POST"),
  headers: z.array(httpHeaderSchema).optional(),
  auth: httpAuthSchema.optional(),
  bodyTemplate: z.string().optional(),
  outputPath: z.string().optional(),
  timeoutMs: z.number().positive().optional(),
  scenarioMappings: z.record(z.string(), agentInputBindingSchema).optional(),
  devTunnel: z
    .object({
      previousUrl: z.string().optional(),
      connectedAt: z.string().optional(),
    })
    .optional(),
});

export type HttpHeader = z.infer<typeof httpHeaderSchema>;
export type HttpAuth = z.infer<typeof httpAuthSchema>;
export type HttpAuthType = HttpAuth["type"];
export type HttpMethod = (typeof HTTP_METHODS)[number];
export type HttpAgentConfig = z.infer<typeof httpAgentConfigSchema>;
