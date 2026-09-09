/**
 * How the legacy Agents family reads in the published document. It still
 * answers, so the document is the only thing that can tell an integrator not
 * to build on it. See modules/agent/specs/package-boundary.feature.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  generateOpenApiDocument,
  type GeneratedOpenApiDocument,
} from "../openapi-document.generator.ts";

/** Every operation of the family that predates the move to `/api/v1/agents`. */
const LEGACY_OPERATIONS = [
  ["get", "/api/agents"],
  ["post", "/api/agents"],
  ["get", "/api/agents/{id}"],
  ["patch", "/api/agents/{id}"],
  ["delete", "/api/agents/{id}"],
] as const;

const SUCCESSOR = "/api/v1/agents";

let generated: GeneratedOpenApiDocument;

function operation(method: string, path: string): { deprecated?: boolean; description?: string } {
  const operations = generated.document.paths?.[path] as
    | Record<string, { deprecated?: boolean; description?: string }>
    | undefined;
  return operations?.[method] ?? {};
}

beforeAll(async () => {
  const scratchDir = await mkdtemp(join(tmpdir(), "langwatch-agents-legacy-openapi-"));
  generated = await generateOpenApiDocument({ outputPath: join(scratchDir, "generated.json") });
});

describe("given the Agents REST compatibility interface is mounted", () => {
  describe("when the OpenAPI document is generated", () => {
    it.each([
      ["post", "/api/v1/agents/connect/register"],
      ["get", "/api/v1/agents/connect/poll"],
      ["post", "/api/v1/agents/connect/frames"],
      ["post", "/api/v1/agents/{id}/call"],
    ])("describes %s %s without constructing AgentApp", (method, path) => {
      expect(generated.operations).toContain(`${method.toUpperCase()} ${path}`);
    });

    /** @scenario "Legacy REST is documented as deprecated" */
    it.each(LEGACY_OPERATIONS)("marks %s %s deprecated and names its successor", (method, path) => {
      const { deprecated, description } = operation(method, path);

      // Still described, so an integrator already on it can read what it does:
      // the operation remains functional and is documented as superseded, not
      // removed from the document.
      expect(description, `${method} ${path} is not in the document`).toBeDefined();
      expect(deprecated).toBe(true);
      expect(description).toContain(SUCCESSOR);
    });

    /** @scenario "Legacy REST is documented as deprecated" */
    it("leaves the surface it points at undeprecated, so the successor is unambiguous", () => {
      expect(operation("get", SUCCESSOR).deprecated).not.toBe(true);
      expect(operation("post", SUCCESSOR).deprecated).not.toBe(true);
    });
  });
});
