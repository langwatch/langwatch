import { z } from "zod";
import { agentSchema, agentViewSchema, agentWithFieldsSchema } from "./agent";
import { agentTypeSchema } from "./config";

export const agentPaginationSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export const agentPageSchema = z.object({
  data: z.array(agentSchema),
  pagination: agentPaginationSchema,
});

export const agentCopySchema = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string(),
  fullPath: z.string(),
});

export const agentHistoryEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  createdAt: z.date(),
  args: z.unknown(),
  user: z
    .object({
      id: z.string(),
      name: z.string().nullable(),
      email: z.string().nullable(),
    })
    .nullable(),
});

export const relatedAgentEntitiesSchema = z.object({
  workflow: z.object({ id: z.string(), name: z.string() }).nullable(),
});

export const agentReferenceStateSchema = z.object({
  id: z.string(),
  archivedAt: z.date().nullable(),
  /**
   * Present so a suite run can tell a connected agent apart from the other
   * types and treat one unseen too long (ADR-128) as archived, the way
   * `findManyIncludingArchived` reads it on main. Absent from a caller that
   * has no use for it.
   */
  type: agentTypeSchema.optional(),
  name: z.string().optional(),
  ownerUserId: z.string().nullable().optional(),
  lastSeenAt: z.date().nullable().optional(),
});

export const agentNameSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const getAgentResultSchema = agentWithFieldsSchema;

export const getAgentQuerySchema = z.object({
  id: z.string(),
  projectId: z.string(),
});

export const listAgentsQuerySchema = z.object({
  projectId: z.string(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(1000).default(50),
});

export const agentIdPathSchema = z.object({ id: z.string().min(1) });

export const agentViewWithPlatformUrlSchema = z.intersection(
  agentViewSchema,
  z.object({ platformUrl: z.string().url() }),
);

export const agentListViewSchema = z.object({
  data: z.array(agentViewWithPlatformUrlSchema),
  pagination: agentPaginationSchema,
});

export const archivedAgentViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["signature", "code", "workflow", "http", "connected"]),
  archivedAt: z.date(),
});

export type AgentPage = z.infer<typeof agentPageSchema>;
export type AgentCopy = z.infer<typeof agentCopySchema>;
export type AgentHistoryEntry = z.infer<typeof agentHistoryEntrySchema>;
export type RelatedAgentEntities = z.infer<typeof relatedAgentEntitiesSchema>;
export type AgentReferenceState = z.infer<typeof agentReferenceStateSchema>;
export type AgentName = z.infer<typeof agentNameSchema>;
export type GetAgentResult = z.infer<typeof getAgentResultSchema>;
