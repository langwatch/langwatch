import { operationSchema } from "../model/operation-schema.ts";

/** A search endpoint whose body exercises every kind of typed form field. */
export const searchThings = operationSchema.parse({
  method: "POST",
  path: "/api/things/search",
  origin: "https://app.langwatch.ai",
  summary: "Search things",
  description: "",
  deprecated: false,
  schemes: [{ id: "api_key", type: "apiKey", in: "header", name: "X-Auth-Token" }],
  parameters: [
    {
      in: "query",
      name: "since",
      required: false,
      deprecated: false,
      description: "",
      schema: { type: "string", format: "date-time" },
    },
    {
      in: "query",
      name: "order",
      required: false,
      deprecated: false,
      description: "",
      schema: { type: "string", enum: ["asc", "desc"] },
    },
    {
      in: "query",
      name: "archived",
      required: false,
      deprecated: false,
      description: "",
      schema: { type: "boolean" },
    },
    {
      in: "query",
      name: "limit",
      required: false,
      deprecated: false,
      description: "",
      schema: { type: "integer", minimum: 1, maximum: 100 },
    },
  ],
  body: {
    required: true,
    description: "",
    contents: [
      {
        type: "application/json",
        schema: {
          type: "object",
          required: ["name", "startDate"],
          properties: {
            name: { type: "string", description: "What to call it." },
            startDate: { type: ["number", "string"] },
            expiresAt: { type: "string", format: "date-time" },
            day: { type: "string", format: "date" },
            createdAt: { type: "number", description: "Unix epoch in milliseconds." },
            updatedAt: { type: "number" },
            format: { type: "string", enum: ["digest", "json"] },
            includeSpans: { type: "boolean" },
            pageSize: { type: "integer", minimum: 1, maximum: 1000 },
            tags: { type: "array", items: { type: "string" } },
            window: {
              type: "object",
              properties: { days: { type: "integer" }, label: { type: "string" } },
            },
            filters: {
              type: "object",
              properties: {
                "topics.topics": { anyOf: [{ type: "array" }, { type: "object" }] },
              },
              additionalProperties: true,
            },
            metadata: { type: "object", additionalProperties: true },
            scrollId: { type: ["string", "null"] },
          },
        },
      },
    ],
  },
  responses: [],
});
