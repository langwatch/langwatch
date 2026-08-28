import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { createProjectApp } from "~/server/api/security";
import {
  apiErrorSchema,
  canonicalBaseResponses,
  patchZodOpenapi,
  requires,
  validator as zValidator,
} from "@langwatch/platform-api/app-rest";
import {
  AgentCacheService,
  CACHE_ENTRY_NAME_REGEX,
  DEFAULT_TTL_SECONDS,
  MAX_NAME_LENGTH,
  MAX_TTL_SECONDS,
  MAX_VALUE_BYTES,
  MIN_TTL_SECONDS,
} from "../agent-cache.service";

patchZodOpenapi();

/**
 * The agent cache: a per-project key-value store an agent writes its own run
 * state into, so work it already paid for happens once for a run instead of
 * once for every row.
 *
 * Three things separate it from the project secret store. An entry expires on
 * its own. An agent writes it, so it holds what the agent produced rather than
 * what an operator typed. And a read returns the value, which is why both
 * reads and writes take `agentCache:manage`: a caller that can overwrite an
 * entry can already choose what the next read answers.
 *
 * There is no listing. Names come from the agent code that wrote them.
 */

const cacheEntryResponseSchema = z.object({
  name: z.string(),
  value: z.string(),
});

const cacheEntryWrittenSchema = z.object({
  name: z.string(),
  ttl_seconds: z.number(),
});

const cacheEntryClaimedSchema = z.object({
  name: z.string(),
  claimed: z.boolean(),
  ttl_seconds: z.number(),
});

const cacheEntryDeletedSchema = z.object({
  name: z.string(),
  deleted: z.boolean(),
});

const nameParamSchema = z.object({
  name: z
    .string()
    .min(1, "name is required")
    .max(MAX_NAME_LENGTH, "name is too long")
    .regex(
      CACHE_ENTRY_NAME_REGEX,
      "name must contain only uppercase letters, digits, and underscores, and must start with a letter",
    ),
});

const putEntrySchema = z.object({
  value: z
    .string()
    .min(1, "value is required")
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= MAX_VALUE_BYTES,
      `value is too long; the limit is ${MAX_VALUE_BYTES} bytes`,
    ),
  ttl_seconds: z
    .number()
    .int()
    .min(MIN_TTL_SECONDS, `ttl_seconds must be at least ${MIN_TTL_SECONDS}`)
    .max(MAX_TTL_SECONDS, `ttl_seconds must be at most ${MAX_TTL_SECONDS}`)
    .optional(),
});

const notFoundResponse = {
  404: {
    description: "The project holds no live entry under that name",
    content: { "application/json": { schema: resolver(apiErrorSchema) } },
  },
};

const agentCacheService = new AgentCacheService();

const secured = createProjectApp({
  basePath: "/api/agent-cache",
  errorEnvelope: "canonical",
});

secured.access(requires("agentCache:manage")).get(
  "/:name",
  describeRoute({
    description: [
      "Read a cache entry by name.",
      "An entry that was never stored, or whose lifetime has passed, answers 404.",
      "Requires the agentCache:manage grain, because a caller that can overwrite an entry can already choose what the next read answers.",
      "A legacy project API key reaches this route, the same as it reaches the rest of the project surface.",
    ].join(" "),
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(cacheEntryResponseSchema),
          },
        },
      },
      ...notFoundResponse,
    },
  }),
  zValidator("param", nameParamSchema),
  async (c) => {
    const project = c.get("project");
    const { name } = c.req.valid("param");

    const entry = await agentCacheService.getByName({
      projectId: project.id,
      name,
    });
    return c.json(entry);
  },
);

secured.access(requires("agentCache:manage")).put(
  "/:name",
  describeRoute({
    description: [
      "Store a value under a name, whether or not the name is held yet.",
      `The value is encrypted at rest and expires by itself after ttl_seconds, which defaults to ${DEFAULT_TTL_SECONDS} seconds.`,
      "The last write wins.",
    ].join(" "),
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "Entry stored",
        content: {
          "application/json": {
            schema: resolver(cacheEntryWrittenSchema),
          },
        },
      },
    },
  }),
  zValidator("param", nameParamSchema),
  zValidator("json", putEntrySchema),
  async (c) => {
    const project = c.get("project");
    const { name } = c.req.valid("param");
    const body = c.req.valid("json");

    const written = await agentCacheService.put({
      projectId: project.id,
      name,
      value: body.value,
      ttlSeconds: body.ttl_seconds,
    });
    return c.json(written);
  },
);

secured.access(requires("agentCache:manage")).post(
  "/:name/claim",
  describeRoute({
    description: [
      "Store a value under a name only if the project does not hold that name yet.",
      "The answer says whether this caller is the one that took it: `claimed` is true when the value was written, and false when the name was already held, which leaves the held value alone.",
      "Losing is an ordinary answer and not a refusal, so a caller branches on `claimed` rather than on an error.",
      "This is what one row of a run uses to do work the rows beside it then reuse, instead of every row doing it at once.",
      `The value is encrypted at rest and expires by itself after ttl_seconds, which defaults to ${DEFAULT_TTL_SECONDS} seconds.`,
    ].join(" "),
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "Claim resolved, taken or not",
        content: {
          "application/json": {
            schema: resolver(cacheEntryClaimedSchema),
          },
        },
      },
    },
  }),
  zValidator("param", nameParamSchema),
  zValidator("json", putEntrySchema),
  async (c) => {
    const project = c.get("project");
    const { name } = c.req.valid("param");
    const body = c.req.valid("json");

    const outcome = await agentCacheService.claim({
      projectId: project.id,
      name,
      value: body.value,
      ttlSeconds: body.ttl_seconds,
    });
    return c.json(outcome);
  },
);

secured.access(requires("agentCache:manage")).delete(
  "/:name",
  describeRoute({
    description:
      "Remove a cache entry. A name the project does not hold answers the same as one it does, so a caller can clear an entry without reading it first.",
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "Entry removed",
        content: {
          "application/json": {
            schema: resolver(cacheEntryDeletedSchema),
          },
        },
      },
    },
  }),
  zValidator("param", nameParamSchema),
  async (c) => {
    const project = c.get("project");
    const { name } = c.req.valid("param");

    await agentCacheService.delete({ projectId: project.id, name });
    return c.json({ name, deleted: true });
  },
);

export const app = secured.hono;
