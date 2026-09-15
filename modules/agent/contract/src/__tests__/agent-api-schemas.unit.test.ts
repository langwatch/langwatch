/**
 * The create schemas both Agents API interfaces validate against.
 * @see modules/agent/specs/package-boundary.feature
 */
import { describe, expect, it } from "vitest";
import { createAgentCommandSchema, createAgentRequestSchema } from "../agent.commands.ts";
import { agentTypeSchema } from "../config/index.ts";

const rpcCreateSchema = createAgentCommandSchema;

/** One well-formed create body per persisted agent type. */
const validRequestFor: Record<string, Record<string, unknown>> = {
  signature: { name: "Summarizer", type: "signature", config: { prompt: "summarize" } },
  code: {
    name: "Scorer",
    type: "code",
    config: {
      parameters: [{ identifier: "code", type: "code", value: "def run(): ..." }],
    },
  },
  workflow: { name: "Pipeline", type: "workflow", config: { workflow_id: "workflow-1" } },
  http: { name: "Webhook", type: "http", config: { url: "https://agents.test/run" } },
  connected: {
    name: "Registered",
    type: "connected",
    config: {
      parameters: [],
      sdk: { name: "langwatch", version: "1.0.0", language: "python" },
    },
  },
};

describe("the Agents create schemas", () => {
  it("combines command fields with HTTP defaults and strips unknown command fields", () => {
    expect(
      rpcCreateSchema.parse({
        projectId: "project-1",
        name: "Webhook",
        type: "http",
        config: { url: "https://agents.test/run" },
        unexpected: true,
      }),
    ).toEqual({
      projectId: "project-1",
      name: "Webhook",
      type: "http",
      config: { url: "https://agents.test/run", method: "POST" },
    });
  });

  describe("given a body that is well formed for its declared type", () => {
    /** @scenario "Contract schemas define both API interfaces" */
    it("is accepted by the RPC and the REST create schema alike, for every persisted type", () => {
      for (const type of agentTypeSchema.options) {
        const body = validRequestFor[type];
        expect(body, `no fixture for the ${type} agent type`).toBeDefined();

        expect(createAgentRequestSchema.safeParse(body).error?.issues ?? []).toEqual([]);
        expect(
          rpcCreateSchema.safeParse({ ...body, projectId: "project-1" }).error?.issues ?? [],
        ).toEqual([]);
      }
    });
  });

  describe("given a config that belongs to another agent type", () => {
    /** @scenario "Contract schemas define both API interfaces" */
    it("is refused by both interfaces, because the create schema is type-specific", () => {
      // A signature agent's config carries no `url`, which the http config requires.
      const mismatched = {
        name: "Webhook",
        type: "http",
        config: validRequestFor.signature!.config,
      };

      const rest = createAgentRequestSchema.safeParse(mismatched);
      const rpc = rpcCreateSchema.safeParse({ ...mismatched, projectId: "project-1" });

      expect(rest.success).toBe(false);
      expect(rpc.success).toBe(false);
      expect(rest.error?.issues.map((issue) => issue.path.join("."))).toEqual(["config.url"]);
      expect(rpc.error?.issues.map((issue) => issue.path.join("."))).toEqual(["config.url"]);
    });
  });

  describe("given the REST framework reading a contract schema", () => {
    /** @scenario "Contract schemas define both API interfaces" */
    it("validates through the schema's own Standard Schema entry point", async () => {
      const standard = createAgentRequestSchema["~standard"];

      expect(standard.version).toBe(1);
      // Zod 4 is what publishes `~standard`; zod/v3 schemas carry no such entry.
      expect(standard.vendor).toBe("zod");
      expect(await standard.validate(validRequestFor.http)).toMatchObject({
        value: { type: "http" },
      });
      expect(await standard.validate({ type: "http" })).toMatchObject({
        issues: expect.any(Array),
      });
    });
  });
});
