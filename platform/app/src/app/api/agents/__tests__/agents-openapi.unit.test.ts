import { generateSpecs } from "hono-openapi";
import { describe, expect, it } from "vitest";
import { app } from "../[[...route]]/app";

describe("Agents OpenAPI contract", () => {
  /** @scenario Contract schemas define both API interfaces */
  it("derives legacy REST validation and response models from contract schemas", async () => {
    const specification = await generateSpecs(app);
    const collection = specification.paths?.["/api/agents"];
    const member = specification.paths?.["/api/agents/{id}"];

    expect(collection?.get?.deprecated).toBe(true);
    expect(collection?.post?.deprecated).toBe(true);
    expect(member?.get?.deprecated).toBe(true);
    expect(member?.patch?.deprecated).toBe(true);
    expect(member?.delete?.deprecated).toBe(true);

    const requestBody = collection?.post?.requestBody as
      | { content?: Record<string, { schema?: unknown }> }
      | undefined;
    const createSchema = requestBody?.content?.["application/json"]?.schema as
      | { oneOf?: unknown[] }
      | undefined;
    expect(createSchema?.oneOf).toHaveLength(4);

    const created = collection?.post?.responses?.[201] as
      | { content?: Record<string, { schema?: unknown }> }
      | undefined;
    const createResponse = created?.content?.["application/json"]?.schema as
      | { allOf?: unknown[] }
      | undefined;
    expect(createResponse?.allOf).toHaveLength(2);

    const listed = collection?.get?.responses?.[200] as
      | { content?: Record<string, { schema?: unknown }> }
      | undefined;
    const listResponse = listed?.content?.["application/json"]?.schema as
      | { properties?: Record<string, unknown> }
      | undefined;
    expect(listResponse?.properties).toHaveProperty("data");
    expect(listResponse?.properties).toHaveProperty("pagination");
  });
});
