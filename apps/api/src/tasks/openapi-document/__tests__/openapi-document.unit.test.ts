/**
 * The served OpenAPI document, generated from the installed module
 * declarations. One declaration is one family; the union is the document.
 *
 * Spec: specs/api/openapi-document.feature.
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { declaredRestFamilies, type DeclaredRestFamily } from "../openapi-document.declarations.ts";
import { generateOpenApiDocument, type OpenApiDocument } from "../openapi-document.generator.ts";
import {
  composeOpenApiDocumentSurface,
  DuplicatePublishedAddressError,
  publishedPathOf,
} from "../openapi-document.surface.ts";
import {
  browserFamily,
  hiddenRouteFamily,
  internalDoorFamily,
  literalFamily,
  organizationFamily,
  projectFamily,
  projectFamilyTwin,
  routeRaisedBrowserDoorFamily,
} from "./openapi-document.fixture.ts";

async function generate(families: readonly DeclaredRestFamily[]) {
  const directory = await mkdtemp(join(tmpdir(), "openapi-document-"));

  return generateOpenApiDocument({ outputPath: join(directory, "document.json"), families });
}

/** The operation object the document publishes at one address. */
function operationAt(
  document: OpenApiDocument,
  operationKey: string,
): Record<string, unknown> | undefined {
  const separator = operationKey.indexOf(" ");

  return document.paths?.[operationKey.slice(separator + 1)]?.[
    operationKey.slice(0, separator).toLowerCase()
  ] as Record<string, unknown> | undefined;
}

describe("given a family declared behind a project key", () => {
  describe("when the document is generated", () => {
    /** @scenario "A declared route is published at its canonical v1 address" */
    it("publishes every declared route at its /api/v1 address", async () => {
      const generated = await generate([projectFamily]);

      expect(generated.operations).toEqual([
        "GET /api/v1/widgets",
        "GET /api/v1/widgets/{id}",
        "POST /api/v1/widgets",
      ]);
    });

    /** @scenario "Every declared route contributes its operation" */
    it("counts the families and routes the declarations named", async () => {
      const generated = await generate([projectFamily]);

      expect(generated.counts).toEqual({ families: 1, routes: 3 });
    });

    /** @scenario "A family behind a project key publishes the project scheme" */
    it("stamps the security requirement the family's credential publishes", async () => {
      const generated = await generate([projectFamily]);

      expect(operationAt(generated.document, "GET /api/v1/widgets")?.security).toEqual([
        { project_api_key: [] },
      ]);
    });

    /** @scenario "An operation requiring a permission publishes the permission" */
    it("publishes the permission the route declares as its access policy", async () => {
      const generated = await generate([projectFamily]);

      expect(operationAt(generated.document, "POST /api/v1/widgets")?.["x-access-policy"]).toEqual({
        kind: "handlerManaged",
        credential: ["project_api_key"],
        permissions: ["widgets:manage"],
      });
    });

    /** @scenario "The declared operation id and summary are published" */
    it("carries the operation id and prose the declaration wrote", async () => {
      const operation = operationAt(
        (await generate([projectFamily])).document,
        "GET /api/v1/widgets/{id}",
      );

      expect(operation?.operationId).toBe("getWidget");
      expect(operation?.summary).toBe("Get one widget");
    });

    /** @scenario "A declared path parameter is published" */
    it("describes the path parameter the route parses", async () => {
      const operation = operationAt(
        (await generate([projectFamily])).document,
        "GET /api/v1/widgets/{id}",
      );

      expect(operation?.parameters).toContainEqual(
        expect.objectContaining({ in: "path", name: "id", required: true }),
      );
    });

    /** @scenario "A declared request body is published as JSON Schema" */
    it("describes the request body the route declares", async () => {
      const operation = operationAt(
        (await generate([projectFamily])).document,
        "POST /api/v1/widgets",
      ) as { requestBody?: { content?: Record<string, { schema?: unknown }> } } | undefined;

      expect(operation?.requestBody?.content?.["application/json"]?.schema).toEqual(
        expect.objectContaining({
          type: "object",
          properties: expect.objectContaining({ name: { type: "string" } }),
        }),
      );
    });

    /** @scenario "The generator writes only where the caller pointed it" */
    it("writes the document where the caller said, and only there", async () => {
      const generated = await generate([projectFamily]);
      const written = JSON.parse(await readFile(generated.outputPath, "utf8")) as OpenApiDocument;

      expect(Object.keys(written.paths ?? {})).toEqual([
        "/api/v1/widgets",
        "/api/v1/widgets/{id}",
      ]);
    });
  });
});

describe("given a family declared behind an organization key", () => {
  describe("when the document is generated", () => {
    /** @scenario "A family behind an organization key publishes the admin scheme" */
    it("publishes the admin key scheme rather than the project one", async () => {
      const generated = await generate([organizationFamily]);

      expect(operationAt(generated.document, "GET /api/v1/tenants")?.security).toEqual([
        { admin_api_key: [] },
      ]);
    });
  });
});

describe("given a family declared behind the deployment's own shared secret", () => {
  describe("when the document is generated", () => {
    /** @scenario "A family behind the deployment's own secret is published, not dropped" */
    it("publishes it under the internal scheme rather than dropping it", async () => {
      const generated = await generate([internalDoorFamily]);

      expect(operationAt(generated.document, "POST /api/v1/relay/dispatch")?.security).toEqual([
        { internal_secret: [] },
      ]);
    });
  });
});

describe("given a family addressed literally", () => {
  describe("when the document is generated", () => {
    /** @scenario "A family with no v1 twin keeps the address it declares" */
    it("publishes each route at the path the route itself writes", async () => {
      const generated = await generate([literalFamily]);

      expect(generated.operations).toEqual(["GET /api/health/live"]);
    });
  });
});

describe("given a route its own declaration hides", () => {
  describe("when the document is generated", () => {
    /** @scenario "A route its declaration hides is left out and named" */
    it("leaves the operation out", async () => {
      const generated = await generate([hiddenRouteFamily]);

      expect(generated.operations).toEqual(["GET /api/v1/legacy/current"]);
    });

    /** @scenario "A route its declaration hides is left out and named" */
    it("reports the absence against the declaration that caused it", async () => {
      const generated = await generate([hiddenRouteFamily]);

      expect(generated.undescribed).toEqual([
        {
          operation: "GET /api/v1/legacy/retired",
          family: "legacy",
          because: "its declaration hides it from the published document",
        },
      ]);
    });
  });
});

describe("given a family reached by a browser session", () => {
  describe("when the document is generated", () => {
    /** @scenario "A family behind a browser session publishes nothing" */
    it("publishes no operation, because no API client can present a cookie", async () => {
      const generated = await generate([browserFamily]);

      expect(generated.operations).toEqual([]);
    });

    /** @scenario "A family behind a browser session publishes nothing" */
    it("still counts the route it read, so the family is not silently absent", async () => {
      const generated = await generate([browserFamily]);

      expect(generated.counts).toEqual({ families: 1, routes: 1 });
    });
  });
});

describe("given a route that raises a browser door inside a published family", () => {
  describe("when the document is generated", () => {
    /** @scenario "An operation no security scheme can express is dropped and named" */
    it("drops the operation rather than advertise a call nothing can make", async () => {
      const generated = await generate([routeRaisedBrowserDoorFamily]);

      expect(generated.operations).toEqual(["GET /api/v1/mixed/open"]);
    });

    /** @scenario "An operation no security scheme can express is dropped and named" */
    it("names the operation and its family, with the reason no scheme fits", async () => {
      const generated = await generate([routeRaisedBrowserDoorFamily]);

      expect(generated.unpublishable).toEqual([
        expect.objectContaining({
          operation: "GET /api/v1/mixed/session",
          family: "mixed",
          because: expect.stringContaining("session"),
        }),
      ]);
    });
  });
});

describe("given two families claiming one published address", () => {
  describe("when the surface is composed", () => {
    /** @scenario "Two declarations cannot publish at one address" */
    it("refuses, naming the address", () => {
      expect(() =>
        composeOpenApiDocumentSurface({ families: [projectFamily, projectFamilyTwin] }),
      ).toThrow(DuplicatePublishedAddressError);
    });
  });
});

describe("given a module whose REST declaration cannot be read", () => {
  describe("when the installed declarations are collected", () => {
    /** @scenario "A module whose declaration cannot be read fails the run" */
    it("fails naming the module rather than dropping the family", () => {
      expect(() =>
        declaredRestFamilies([
          {
            name: "broken",
            transports: [
              {
                protocol: "rest",
                router: () => {
                  throw new Error("its contract moved");
                },
              },
            ],
          },
        ]),
      ).toThrow(/Module "broken".*its contract moved/s);
    });

    /** @scenario "A router handing back something that is not a declaration fails the run" */
    it("fails when the router hands back something that is not a declaration", () => {
      expect(() =>
        declaredRestFamilies([
          { name: "hollow", transports: [{ protocol: "rest", router: () => ({}) }] },
        ]),
      ).toThrow(/Module "hollow".*not a REST declaration/s);
    });
  });

  describe("when a tRPC transport sits beside it", () => {
    /** @scenario "A tRPC transport beside a REST one is passed over" */
    it("reads the REST one and passes over the other", () => {
      const families = declaredRestFamilies([
        {
          name: "widget",
          transports: [
            { protocol: "trpc", namespace: "widget", router: () => ({}) },
            projectFamily.descriptor,
          ],
        },
      ]);

      expect(families.map(({ module }) => module)).toEqual(["widget"]);
    });
  });
});

describe("given a declared route", () => {
  describe("when its published address is computed", () => {
    /** @scenario "A path parameter is spelled the way the document spells it" */
    it("writes a path parameter the way the document spells it", () => {
      const route = projectFamily.declaration.routes.find(({ path }) => path === "/:id");

      expect(publishedPathOf({ route: route!, declaration: projectFamily.declaration })).toBe(
        "/api/v1/widgets/{id}",
      );
    });

    /** @scenario "A collection route is addressed at the family root" */
    it("addresses a collection route at the family root", () => {
      const route = projectFamily.declaration.routes.find(({ path }) => path === "/");

      expect(publishedPathOf({ route: route!, declaration: projectFamily.declaration })).toBe(
        "/api/v1/widgets",
      );
    });
  });
});
