/**
 * The REST transport's declaration surface and its version vocabulary: what
 * `defineRestRouter` records and refuses, and how a static generation is
 * selected from a path, a header or neither.
 */
import { featureApi } from "@langwatch/runtime-composition";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { anyAuthenticated, publicRoute } from "../../access/access.ts";
import { ApiVersionConflictError, InvalidApiVersionError } from "../../errors.ts";
import {
  bindRestHeader,
  bindRestMiddleware,
  defineRestMiddleware,
  type RestTransportMiddlewareBinding,
} from "../request.ts";
import {
  API_VERSION_HEADER,
  createRestRuntime,
  defineRestRouter,
  projectRestFacts,
  RestVersionSelector,
  restVersionSelectorMiddleware,
} from "../runtime.ts";

describe("defineRestRouter", () => {
  /** @scenario "A REST endpoint is one complete declaration in the server" */
  it("keeps route declarations inert and callable for feature discovery", () => {
    const api = featureApi<{ get(input: { id: string }): Promise<{ id: string }> }>("annotation");

    const transport = defineRestRouter(api)
      .withNamespace("annotations")
      .withVersion("2026-08-07")
      .get("/:id", "getAnnotation")
      .withParams(z.object({ id: z.string() }))
      .withPermission("annotations:view")
      .withOutput(z.object({ id: z.string() }))
      .handle(({ input }) => ({ id: input.id }))

      .delete("/:id", "deleteAnnotation")
      .withParams(z.object({ id: z.string() }))
      .withPermission("annotations:view")
      .handle(async () => {})
      .build();

    const declaration = transport.router();

    expect(declaration).toMatchObject({
      protocol: "rest",
      api,
      namespace: "annotations",
      version: "2026-08-07",
      routes: [{ method: "get" }, { method: "delete" }],
    });

    expect(declaration.routes[1]?.output.safeParse(void 0).success).toBe(true);
  });

  it("rejects conflicting request sources and malformed path parameters", () => {
    const api = featureApi<{ get(input: { id: string }): Promise<{ id: string }> }>("annotation");

    const router = () =>
      defineRestRouter(api).withNamespace("annotations").withVersion("2026-08-07");

    expect(() => {
      const route = router()
        .patch("/:id", "updateAnnotation")
        .withParams(z.object({ id: z.string() }));

      Reflect.apply(route.withInput, route, [z.object({ id: z.string() })]);
    }).toThrow(/declared by multiple sources/);

    expect(() => {
      const route = router()
        .patch("/:id", "updateVariant")
        .withParams(z.object({ id: z.string() }));

      const body = z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("text"), text: z.string() }),
        z.object({ kind: z.literal("reference"), id: z.string() }),
      ]);

      Reflect.apply(route.withInput, route, [body]);
    }).toThrow(/declared by multiple sources/);

    expect(() => {
      const dynamicPath = "/:id" as string;
      const route = router().get(dynamicPath, "getAnnotation");
      Reflect.apply(route.withParams, route, [z.object({ annotationId: z.string() })]);
    }).toThrow(/must exactly match/);

    expect(() => {
      const dynamicPath = "/:id" as string;

      router()
        .get(dynamicPath, "missingParams")
        .withPermission("annotations:view")
        .handle(() => {});
    }).toThrow(/must declare withParams/);

    expect(() => {
      const declared = router()
        .get("/annotations", "listAnnotations")
        .withPermission("annotations:view")
        .handle(() => {});

      declared
        .get("/annotations", "listAnnotationsAgain")
        .withPermission("annotations:view")
        .handle(() => {});
    }).toThrow(/already registered/);

    expect(() => defineRestRouter(api).withNamespace("Annotations")).toThrow(/lower kebab case/);
  });

  describe("when a route answers without a credential", () => {
    /** @scenario "A route that answers without a credential names no tenant" */
    it("refuses a public route whose own input names a scope", () => {
      const api = featureApi<{ ping(): Promise<void> }>("ops");

      expect(() =>
        defineRestRouter(api)
          .withNamespace("ops")
          .withVersion("2026-08-07")
          .post("/report", "reportBug")
          .withInput(z.object({ projectId: z.string() }))
          .withAccess(publicRoute({ reason: "issue intake; reporters may hold no credential" }))
          .handle(() => {}),
      ).toThrow(/cannot take "projectId" as input/);
    });

    /** @scenario "A route that answers without a credential names no tenant" */
    it("refuses a route that declares both a permission and public access", () => {
      const api = featureApi<{ ping(): Promise<void> }>("ops");

      expect(() =>
        defineRestRouter(api)
          .withNamespace("ops")
          .withVersion("2026-08-07")
          .get("/health", "readHealth")
          .withPermission("project:view")
          .withAccess(publicRoute({ reason: "liveness probe; reads no project data" }))
          .handle(() => {}),
      ).toThrow(/declares both a permission and public access/);
    });

    it("refuses a route that declares neither", () => {
      const api = featureApi<{ ping(): Promise<void> }>("ops");

      expect(() => {
        const route = defineRestRouter(api)
          .withNamespace("ops")
          .withVersion("2026-08-07")
          .get("/health", "readHealth");

        Reflect.apply(route.handle, route, [() => {}]);
      }).toThrow(/must declare withPermission\(\) or withAccess\(\)/);
    });
  });

  describe("when a route is gated by the family's door alone", () => {
    const OpsApi = featureApi<{ ping(): Promise<void> }>("ops");

    /** @scenario "A route the family's own door alone gates asks no permission of it" */
    it("refuses a route that declares both a permission and authenticated access", () => {
      expect(() =>
        defineRestRouter(OpsApi)
          .withNamespace("projects")
          .withVersion("2026-08-07")
          .post("/", "createProject")
          .withInput(z.object({ name: z.string() }))
          .withPermission("project:create")
          .withAccess(anyAuthenticated({ reason: "the key's own ceiling is the whole gate" }))
          .handle(() => {}),
      ).toThrow(/declares both a permission and authenticated access/);
    });

    /** @scenario "A route the family's own door alone gates asks no permission of it" */
    it("refuses a mount that cannot open the door without a permission, naming the route", () => {
      const declaration = defineRestRouter(OpsApi)
        .withNamespace("projects")
        .withVersion("2026-08-07")
        .withCredential("organizationKey")
        .get("/", "listProjects")
        .withAccess(anyAuthenticated({ reason: "the listing answers exactly what the key holds" }))
        .handle(() => {})
        .build()
        .router();

      const runtime = createRestRuntime({
        identity: {
          authenticate: () => ({ actor: null, scope: { tier: "organization", id: "org-1" } }),
        },
      });

      expect(() =>
        runtime.mount(declaration, {
          app: () => ({ ping: async () => {} }),
          onError: (error) => {
            throw error;
          },
        }),
      ).toThrow(/GET \/api\/projects\/ .*supplied no identity\.identify/s);
    });

    it("refuses an access kind with no written reason", () => {
      expect(() => anyAuthenticated({ reason: "  " })).toThrow(/needs a written reason/);
    });
  });

  describe("when a route checks its permission at the scope its path names", () => {
    const ProjectApi = featureApi<{ ping(): Promise<void> }>("project");

    /** @scenario "A route checks its permission at the scope its own path names" */
    it("refuses a route whose sources parse no such field", () => {
      expect(() =>
        defineRestRouter(ProjectApi)
          .withNamespace("projects")
          .withVersion("2026-08-07")
          .withCredential("organizationKey")
          .get("/:id", "getProject")
          .withParams(z.object({ id: z.string() }))
          .withPermission("project:view", { at: "route", param: "projectId" })
          .handle(() => {}),
      ).toThrow(/declares no source that parses "projectId"/);
    });

    /** @scenario "A route checks its permission at the scope its own path names" */
    it("refuses a mount that cannot ask the question, naming the route", () => {
      const declaration = defineRestRouter(ProjectApi)
        .withNamespace("projects")
        .withVersion("2026-08-07")
        .withCredential("organizationKey")
        .get("/:projectId", "getProject")
        .withParams(z.object({ projectId: z.string() }))
        .withPermission("project:view", { at: "route", param: "projectId" })
        .handle(() => {})
        .build()
        .router();

      const runtime = createRestRuntime({
        identity: {
          authenticate: () => ({ actor: null, scope: { tier: "organization", id: "org-1" } }),
        },
      });

      expect(() =>
        runtime.mount(declaration, {
          app: () => ({ ping: async () => {} }),
          onError: (error) => {
            throw error;
          },
        }),
      ).toThrow(/GET \/api\/projects\/:projectId checks "project:view".*no identity\.authorize/s);
    });
  });

  describe("when a route declares the several answers it may give", () => {
    const HealthApi = featureApi<{ ping(): Promise<void> }>("platform-health");
    const report = z.object({ status: z.string() });

    function route() {
      return defineRestRouter(HealthApi)
        .withNamespace("platform-health")
        .withVersion("2026-08-07")
        .get("/", "getPlatformHealth")
        .withPermission("project:view");
    }

    /** @scenario "An endpoint that declares several answers may not also declare one" */
    it("refuses a second answer declaration, and a fixed success status beside it", () => {
      expect(() => route().withOutput(report).responds({ 200: report, 503: report })).toThrow(
        /already declared withOutput/,
      );

      expect(() => route().responds({ 200: report, 503: report }).withOutput(report)).toThrow(
        /already declared withOutput/,
      );

      expect(() =>
        route()
          .responds({ 200: report, 503: report })
          .withStatus(200)
          .handle(() => ({ status: 200, body: { status: "healthy" } })),
      ).toThrow(/its status is the answer's own/);
    });

    /** @scenario "An endpoint that declares several answers may not also declare one" */
    it("refuses a map with no success status, or with more than two", () => {
      expect(() => route().responds({ 503: report })).toThrow(/one or two 2xx answers/);
      expect(() => route().responds({ 200: report, 201: report, 202: report })).toThrow(
        /one or two 2xx answers/,
      );
      expect(() => route().responds({})).toThrow(/no answers/);
      expect(() => route().responds({ 700: report })).toThrow(/outside 200–599/);
    });

    /** @scenario "An endpoint answers 201 when it created what it returned and 200 when it replaced it" */
    it("takes two successes carrying one body, and refuses two carrying different ones", () => {
      expect(() => route().responds({ 200: report, 201: report })).not.toThrow();

      expect(() =>
        route().responds({ 200: report, 201: z.object({ other: z.string() }) }),
      ).toThrow(/two successes carrying different bodies/);
    });
  });

  describe("when a route reads or writes its own bytes", () => {
    const HookApi = featureApi<{ record(): Promise<void> }>("webhook");
    const answer = z.object({ ok: z.boolean() });

    function hook() {
      return defineRestRouter(HookApi)
        .withNamespace("hooks")
        .withVersion("2026-08-07")
        .post("/hook", "recordHook")
        .withPermission("annotations:manage");
    }

    /** @scenario "A handler is given the exact request bytes" */
    it("refuses a route that declares both a raw body and a parsed one", () => {
      expect(() => hook().withRawBody("bytes").withInput(z.object({ a: z.number() }))).toThrow(
        /declares its body twice/,
      );

      expect(() => hook().withInput(z.object({ a: z.number() })).withRawBody("bytes")).toThrow(
        /declares its body twice/,
      );

      expect(() => hook().withRawBody("bytes").withRawBody("text")).toThrow(
        /already declared withRawBody/,
      );
    });

    /** @scenario "An endpoint answers outside the JSON contract when it declares what it produces" */
    it("refuses a route that declares both a schema and a raw answer, or names no media type", () => {
      expect(() => hook().withOutput(answer).withRawResponse({ produces: "text/plain" })).toThrow(
        /both an output schema and a raw response/,
      );

      expect(() => hook().withRawResponse({ produces: "text/plain" }).withOutput(answer)).toThrow(
        /both an output schema and a raw response/,
      );

      expect(() => hook().withRawResponse({ produces: [] })).toThrow(/names no media type/);
      expect(() => hook().withRawResponse({ produces: "   " })).toThrow(/names no media type/);
    });

    /** @scenario "A reader answers HEAD with the headers its GET would carry and no body" */
    it("refuses a body beside a method that carries none, and a method set it is not in", () => {
      expect(() =>
        hook()
          .withInput(z.object({ a: z.number() }))
          .methods(["POST", "GET"])
          .withOutput(answer)
          .handle(() => ({ ok: true })),
      ).toThrow(/declares a body and answers GET, which carries none/);

      expect(() => hook().methods(["GET"])).toThrow(/which is not among them/);
      expect(() => hook().methods([])).toThrow(/named no method/);
      expect(() => hook().methods(["POST", "POST"])).toThrow(/the same method twice/);
    });

    /** @scenario "One path answers every method when that is the surface" */
    it("refuses an any-method route with a body, with named methods, or with no media type", () => {
      expect(() =>
        hook()
          .withInput(z.object({ a: z.number() }))
          .anyMethod()
          .withRawResponse({ produces: "application/json" })
          .handle(() => new Response()),
      ).toThrow(/a body reaches only some of them/);

      expect(() =>
        hook()
          .anyMethod()
          .methods(["POST"])
          .withRawResponse({ produces: "application/json" })
          .handle(() => new Response()),
      ).toThrow(/answers every method and also names some of them/);

      expect(() =>
        hook()
          .anyMethod()
          .withOutput(answer)
          .handle(() => ({ ok: true })),
      ).toThrow(/it must declare withRawResponse/);
    });
  });

  describe("when a family declares the door it answers behind", () => {
    const OrganizationApi = featureApi<{ listRoles(): Promise<void> }>("role");

    /** @scenario "A declaration names the credential its routes accept" */
    it("records the declared door, and defaults to the project key", () => {
      const organization = defineRestRouter(OrganizationApi)
        .withNamespace("roles")
        .withVersion("2026-08-07")
        .withCredential("organizationKey")
        .get("/", "listRoles")
        .withPermission("organization:manage")
        .handle(() => {})
        .build()
        .router();

      const project = defineRestRouter(OrganizationApi)
        .withNamespace("roles")
        .withVersion("2026-08-07")
        .get("/", "listRoles")
        .withPermission("organization:manage")
        .handle(() => {})
        .build()
        .router();

      expect(organization.credential).toBe("organizationKey");
      expect(project.credential).toBe("projectKey");
    });

    /** @scenario "A declaration names the credential its routes accept" */
    it("refuses a door declared after the first route", () => {
      const router = defineRestRouter(OrganizationApi)
        .withNamespace("roles")
        .withVersion("2026-08-07")
        .get("/", "listRoles")
        .withPermission("organization:manage")
        .handle(() => {});

      expect(() => router.withCredential("organizationKey")).toThrow(
        /must declare its credential before its routes/,
      );
    });

    /** @scenario "A declaration names the credential its routes accept" */
    it("carries an addressing declared before the door", () => {
      const declaration = defineRestRouter(OrganizationApi)
        .withNamespace("coding-agent")
        .withVersion("2026-08-07")
        .withAddressing("v1-only")
        .withCredential("organizationKey")
        .get("/", "listRoles")
        .withPermission("organization:manage")
        .handle(() => {})
        .build()
        .router();

      expect(declaration).toMatchObject({ addressing: "v1-only", credential: "organizationKey" });
    });

    /** @scenario "A mount cannot answer a declaration behind the other door" */
    it("refuses a mount naming the door the declaration did not declare", () => {
      const declaration = defineRestRouter(OrganizationApi)
        .withNamespace("roles")
        .withVersion("2026-08-07")
        .withCredential("organizationKey")
        .get("/", "listRoles")
        .withPermission("organization:manage")
        .handle(() => {})
        .build()
        .router();

      const runtime = createRestRuntime({
        identity: {
          authenticate: () => ({ actor: null, scope: { tier: "organization", id: "org-1" } }),
        },
      });

      expect(() =>
        runtime.mount(declaration, {
          app: () => ({ listRoles: async () => {} }),
          credential: "projectKey",
          onError: (error) => {
            throw error;
          },
        }),
      ).toThrow(/declares the "organizationKey" door and this mount names "projectKey"/);
    });
  });

  describe("when a family declares how it is addressed", () => {
    it("refuses an addressing declared after the first route", () => {
      const api = featureApi<{ ping(): Promise<void> }>("ops");

      const router = defineRestRouter(api)
        .withNamespace("ops")
        .withVersion("2026-08-07")
        .get("/health", "readHealth")
        .withPermission("project:view")
        .handle(() => {});

      expect(() => router.withAddressing("v1-only")).toThrow(
        /must declare its addressing before its routes/,
      );
    });

    /** @scenario "A family whose paths were never aliased declares no twin" */
    it("refuses a twin declared by a family that names its generation in the path", () => {
      const api = featureApi<{ ping(): Promise<void> }>("ops");

      const router = () =>
        defineRestRouter(api).withNamespace("webhooks").withVersion("2026-08-07");

      expect(() => router().withAddressing("v1-in-path", { v1Twin: false })).toThrow(
        /has no \/api\/v1 twin to declare/,
      );

      expect(router().withAddressing("dated", { v1Twin: false })).toBeDefined();
    });
  });
});

describe("a mount binding the facts a declaration names", () => {
  const OpsApi = featureApi<{ ping(): Promise<void> }>("ops");
  const surface = defineRestMiddleware("surface", z.string().nullable());

  function declaration() {
    return defineRestRouter(OpsApi)
      .withNamespace("ops")
      .withVersion("2026-08-07")
      .get("/health", "readOpsHealth")
      .withPermission("project:view")
      .withMiddleware(projectRestFacts, surface)
      .handle(() => {})
      .build()
      .router();
  }

  const project = bindRestMiddleware(projectRestFacts, () => ({
    projectSlug: "acme",
    viewerUserId: null,
    actorId: "user-1",
  }));

  function mountWith(facts: readonly RestTransportMiddlewareBinding[]): () => void {
    const runtime = createRestRuntime({
      identity: {
        authenticate: () => ({ actor: null, scope: { tier: "project", id: "project-1" } }),
      },
    });

    return () => {
      runtime.mount(declaration(), {
        app: () => ({ ping: async () => {} }),
        credential: "projectKey",
        onError: (error) => {
          throw error;
        },
        facts,
      });
    };
  }

  /** @scenario "A route's declared facts are bound once at the mount and reach every handler" */
  it("refuses a mount that bound no value for a declared fact, naming the fact and the route", () => {
    expect(mountWith([project])).toThrow(
      /GET \/api\/ops\/health declares the fact "surface", and this mount bound no value for it/,
    );
  });

  /** @scenario "A route's declared facts are bound once at the mount and reach every handler" */
  it("mounts once every declared fact is bound", () => {
    expect(mountWith([project, bindRestHeader(surface, "x-langwatch-surface")])).not.toThrow();
  });
});

describe("RestVersionSelector", () => {
  const selector = RestVersionSelector.create({
    versions: ["v1", "v2"],
    latestVersion: "v2",
  });

  it("uses the explicit path version", () => {
    expect(selector.select({ pathVersion: "v1" })).toEqual({ version: "v1", source: "path" });
  });

  it("uses a supported header when the path is unversioned", () => {
    expect(selector.headerName).toBe(API_VERSION_HEADER);
    expect(selector.select({ headerVersion: "v1" })).toEqual({
      version: "v1",
      source: "header",
    });
  });

  it("uses the configured latest version without a path or header", () => {
    expect(selector.select({})).toEqual({ version: "v2", source: "latest" });
  });

  it("rejects a conflicting explicit path and header", () => {
    expect(() => selector.select({ pathVersion: "v1", headerVersion: "v2" })).toThrow(
      ApiVersionConflictError,
    );
  });

  it.each([{ pathVersion: "v3" }, { headerVersion: "v3" }])(
    "rejects unknown versions: %o",
    (request) => {
      expect(() => selector.select(request)).toThrow(InvalidApiVersionError);
    },
  );

  it("rejects an invalid selector configuration", () => {
    expect(() => RestVersionSelector.create({ versions: [], latestVersion: "v1" })).toThrow(
      /at least one supported version/,
    );
    expect(() => RestVersionSelector.create({ versions: ["v1"], latestVersion: "v2" })).toThrow(
      /latestVersion must be supported/,
    );
  });

  it("applies static selection to a hand-mounted REST route", async () => {
    const app = new Hono()
      .use(
        "*",
        restVersionSelectorMiddleware({
          selector: RestVersionSelector.create({ versions: ["v1"], latestVersion: "v1" }),
        }),
      )
      .get("/things", (context) => context.json({ ok: true }));

    const latest = await app.request("/things");
    const pinned = await app.request("/things", { headers: { "X-API-Version": "v1" } });

    expect(latest.headers.get("X-API-Version")).toBe("v1");
    expect(latest.headers.get("X-API-Version-Status")).toBe("latest");
    expect(pinned.headers.get("X-API-Version-Status")).toBe("stable");
  });
});
