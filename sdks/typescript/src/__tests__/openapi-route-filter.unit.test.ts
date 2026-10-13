import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  collectReferences,
  filterDocument,
  listSourceFiles,
} from "../../scripts/filter-openapi-document.mjs";

const SDK_SRC = resolve(__dirname, "..");
const GENERATED = join(SDK_SRC, "internal/generated");

const document = {
  openapi: "3.1.0",
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    schemas: {
      Trace: { type: "object", properties: { span: { $ref: "#/components/schemas/Span" } } },
      Span: { type: "object", properties: { value: { $ref: "#/components/schemas/Json" } } },
      Json: { type: "string" },
      Annotation: { type: "object" },
      Unused: { type: "object" },
    },
  },
  paths: {
    "/api/v1/traces/{id}": {
      get: {
        operationId: "getTrace",
        responses: {
          200: {
            content: { "application/json": { schema: { $ref: "#/components/schemas/Trace" } } },
          },
        },
      },
    },
    "/api/v1/dataset": { post: { operationId: "postApiDataset" } },
    "/api/v1/unused": { get: { operationId: "getUnused" } },
  },
};

describe("filterDocument", () => {
  describe("when the source calls one route, indexes an operation and names a schema", () => {
    const references = collectReferences({
      sources: [
        `await apiClient\n  .GET(\n    "/api/v1/traces/{id}", {});`,
        `type Body = operations["postApiDataset"]; type A = components["schemas"]["Annotation"];`,
      ],
    });
    const filtered = filterDocument({ document, references });

    it("keeps only the called and indexed routes", () => {
      expect(Object.keys(filtered.paths)).toEqual(["/api/v1/traces/{id}", "/api/v1/dataset"]);
    });

    it("keeps every schema the routes reach through $ref, and the named one", () => {
      expect(Object.keys(filtered.components.schemas)).toEqual([
        "Trace",
        "Span",
        "Json",
        "Annotation",
      ]);
    });

    it("keeps the security schemes whole", () => {
      expect(filtered.components.securitySchemes).toEqual(document.components.securitySchemes);
    });
  });
});

describe("the committed client types", () => {
  it("declare every route the SDK source names", () => {
    const sources = listSourceFiles({ directory: SDK_SRC, skip: [GENERATED] }).map((file) =>
      readFileSync(file, "utf8"),
    );
    const generated = readFileSync(join(GENERATED, "openapi/api-client.ts"), "utf8");
    const missing = [...collectReferences({ sources }).paths].filter(
      (path) => !generated.includes(`    "${path}": {`),
    );

    expect(missing).toEqual([]);
  });
});
