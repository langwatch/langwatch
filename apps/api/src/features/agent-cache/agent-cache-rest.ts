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
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { requires } from "@langwatch/api";
import {
  apiErrorSchema,
  type AppRestProjectVariables,
  type AppRestSecurity,
  canonicalBaseResponses,
  type SecuredApp,
  validator as zValidator,
} from "@langwatch/api/rest";

/**
 * The limits the surface publishes and enforces.
 *
 * They live with the transport because they ARE the contract: the sentences
 * below quote them, the validator refuses on them, and the store that keeps
 * an entry reads the same values so a caller cannot be told one lifetime and
 * given another.
 */
/** How long an entry lives when the caller names no lifetime. */
export const DEFAULT_TTL_SECONDS = 15 * 60;
/** Below this an entry expires before a second row can read it. */
export const MIN_TTL_SECONDS = 5;
/** A day. Anything a run needs for longer belongs in a secret or a dataset. */
export const MAX_TTL_SECONDS = 24 * 60 * 60;
/** 32 KB, which holds a session envelope and refuses a payload. */
export const MAX_VALUE_BYTES = 32 * 1024;
/** Same shape as an environment variable name, so agent code reads the same. */
export const CACHE_ENTRY_NAME_REGEX = /^[A-Z][A-Z0-9_]*$/;
export const MAX_NAME_LENGTH = 64;

/**
 * The per-project entry store this surface dispatches through.
 *
 * Encryption at rest and the expiring store an entry lives in are both the
 * process's, so the capability arrives as a port rather than being built here.
 */
export type AgentCacheStore = Readonly<{
  /** The entry, or the one refusal every empty read answers with. */
  getByName(input: { projectId: string; name: string }): Promise<{ name: string; value: string }>;
  put(input: {
    projectId: string;
    name: string;
    value: string;
    ttlSeconds?: number;
  }): Promise<{ name: string; ttl_seconds: number }>;
  claim(input: {
    projectId: string;
    name: string;
    value: string;
    ttlSeconds?: number;
  }): Promise<{ name: string; claimed: boolean; ttl_seconds: number }>;
  delete(input: { projectId: string; name: string }): Promise<void>;
}>;

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

/**
 * The agent cache REST family, built against one process's security and one
 * process's entry store.
 *
 * `agentCache()` is resolved per request rather than held, so mounting the
 * family constructs nothing and the spec generator can build every route with
 * no running process.
 */
export function createAgentCacheRestApp(options: {
  security: AppRestSecurity;
  agentCache: () => AgentCacheStore;
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security, agentCache } = options;

  const secured = security.createProjectApp({
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

      const entry = await agentCache().getByName({
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

      const written = await agentCache().put({
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

      const outcome = await agentCache().claim({
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

      await agentCache().delete({ projectId: project.id, name });
      return c.json({ name, deleted: true });
    },
  );

  return secured;
}
