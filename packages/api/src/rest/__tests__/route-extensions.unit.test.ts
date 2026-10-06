/**
 * Several permissions together (E2), a permission chosen from the input (E3), a named plan
 * capability (E6) and an array body's field (E1) on a REST route. Specs: packages/api/specs/
 * transport-declaration-split, endpoint-capabilities and transport-conventions .feature.
 */
import { PermissionDeniedError, type AuthzPermission } from "@langwatch/authorization";
import { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/module";
import { generateSpecs } from "hono-openapi";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Entitlements } from "../../access/access.ts";
import { permissionBy } from "../../access/input-permission.ts";
import { createErrorHandler } from "../../errors.ts";
import type { RestCaller, RestIdentity } from "../../hosting/api-door.ts";
import { allRegisteredRoutes } from "../../route-registry.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

/** The refusal a process gives for the webhook endpoints capability. */
class NoWebhookEndpointsError extends HandledError {
  constructor() {
    super("forbidden", "The plan holds no webhook endpoints", {
      httpStatus: 403,
      fault: "customer",
    });
  }
}

const VERSION = "2026-10-05";
const JSON_TYPE = { "content-type": "application/json" };
const PROJECT_CALLER: RestCaller = {
  actor: { type: "api_key", id: "key-1" },
  scope: { tier: "project", id: "project-1" },
};
const ORGANIZATION_CALLER: RestCaller = {
  actor: { type: "api_key", id: "key-1" },
  scope: { tier: "organization", id: "org-1" },
};

interface RunsApi {
  trigger(input: unknown): Promise<{ ran: boolean }>;
}

const RunsApi = moduleApi<RunsApi>()("workflow");
const runsApp = { trigger: async () => ({ ran: true }) };

type Asked = Readonly<{ permission: AuthzPermission; target: unknown }>;

function door({
  caller = PROJECT_CALLER,
  refuses = [],
}: {
  caller?: RestCaller;
  refuses?: readonly AuthzPermission[];
} = {}) {
  const asked: Asked[] = [];
  const identity = {
    authenticate: vi.fn(({ permissions }: { permissions: readonly AuthzPermission[] }) => {
      const missing = permissions.find((permission) => refuses.includes(permission));
      if (missing) {
        throw new PermissionDeniedError({
          permission: missing,
          scope: { type: "project", id: "project-1" },
          denialReason: "no-binding",
        });
      }

      return caller;
    }),
    identify: vi.fn(() => caller),
    authorize: vi.fn(({ permission, target }: { permission: AuthzPermission; target: unknown }) => {
      asked.push({ permission, target });

      return { permitted: !refuses.includes(permission), organizationRole: null };
    }),
  } satisfies RestIdentity;

  return { asked, identity };
}

function registered(prefix: string) {
  return allRegisteredRoutes().find(
    (route) => route.method === "POST" && route.path.startsWith(prefix),
  );
}

function mount(
  router: Parameters<ReturnType<typeof createRestRuntime>["mount"]>[0],
  identity: RestIdentity,
  entitlements?: Entitlements,
) {
  return createRestRuntime({ identity, ...(entitlements ? { entitlements } : {}) }).mount(router, {
    app: () => runsApp,
    onError: createErrorHandler(),
  });
}

describe("a route that requires several permissions together", () => {
  function declaration(ran: string[]) {
    return defineRestRouter(RunsApi)
      .withNamespace("e2-runs")
      .withVersion(VERSION)
      .withCredential("project")
      .post("/trigger", "trigger")
      .withInput(z.object({ name: z.string() }))
      .withPermission(["workflows:create", "evaluations:view"])
      .withOutput(z.object({ ran: z.boolean() }))
      .handle(() => {
        ran.push("trigger");

        return { ran: true };
      })
      .build()
      .router();
  }

  /** @scenario "A route may require several permissions together" */
  it("asks the door every one of them, in the order declared", async () => {
    const ran: string[] = [];
    const { identity } = door();
    const app = mount(declaration(ran), identity);

    const response = await app.request(`/api/e2-runs/${VERSION}/trigger`, {
      method: "POST",
      headers: JSON_TYPE,
      body: JSON.stringify({ name: "nightly" }),
    });

    expect(response.status).toBe(200);
    expect(identity.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: "workflows:create",
        permissions: ["workflows:create", "evaluations:view"],
      }),
    );
    expect(ran).toEqual(["trigger"]);
  });

  /** @scenario "A route may require several permissions together" */
  it("is refused before the body is read when the door refuses the second", async () => {
    const ran: string[] = [];
    const { identity } = door({ refuses: ["evaluations:view"] });
    const app = mount(declaration(ran), identity);

    const response = await app.request(`/api/e2-runs/${VERSION}/trigger`, {
      method: "POST",
      headers: JSON_TYPE,
      body: "{",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "permission_denied" });
    expect(ran).toEqual([]);
  });

  /** @scenario "A route may require several permissions together" */
  it("asks each at the scope its path names, and stops at the first the caller lacks", async () => {
    const ran: string[] = [];
    const { asked, identity } = door({
      caller: ORGANIZATION_CALLER,
      refuses: ["workflows:create"],
    });
    const router = defineRestRouter(RunsApi)
      .withNamespace("project-runs")
      .withVersion(VERSION)
      .withCredential("organization")
      .post("/:projectId/trigger", "trigger")
      .withParams(z.object({ projectId: z.string() }))
      .withPermission(["evaluations:view", "workflows:create"], {
        at: "route",
        param: "projectId",
      })
      .withOutput(z.object({ ran: z.boolean() }))
      .handle(() => {
        ran.push("trigger");

        return { ran: true };
      })
      .build()
      .router();

    identity.authenticate.mockImplementation(() => ORGANIZATION_CALLER);

    const response = await mount(router, identity).request(
      `/api/project-runs/${VERSION}/project-7/trigger`,
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "permission_denied" });
    expect(asked).toEqual([
      { permission: "evaluations:view", target: { tier: "project", id: "project-7" } },
      { permission: "workflows:create", target: { tier: "project", id: "project-7" } },
    ]);
    expect(ran).toEqual([]);
  });

  /** @scenario "A route may require several permissions together" */
  it("records every permission in the registry and the document", async () => {
    const app = mount(declaration([]), door().identity);

    expect(registered("/api/e2-runs/")).toMatchObject({
      policy: { permissions: ["workflows:create", "evaluations:view"] },
    });

    const published = await generateSpecs(app, { excludeStaticFile: false });
    const operations = Object.entries(published.paths ?? {}).filter(([path]) =>
      path.includes("/e2-runs/"),
    );

    expect(operations).not.toEqual([]);
    expect(JSON.stringify(operations)).toContain("evaluations:view");
  });

  /** @scenario "A route may require several permissions together" */
  it("refuses a set of one, a repeat, and one no single scope grants", () => {
    const route = () =>
      defineRestRouter(RunsApi).withNamespace("e2-runs").withVersion(VERSION).post("/", "trigger");

    expect(() => route().withPermission(["workflows:create"] as never)).toThrow(
      /names 1 permissions to check together/,
    );
    expect(() => route().withPermission(["workflows:create", "workflows:create"])).toThrow(
      /names one permission twice/,
    );
    expect(() => route().withPermission(["workflows:create", "ops:view"])).toThrow(
      /no one scope grants them all/,
    );
  });
});

describe("a route that chooses its permission from its parsed input", () => {
  const dispatchInput = z.object({
    kind: z.enum(["view", "update", "share"]),
    target: z.object({ organizationId: z.string() }).optional(),
  });

  const BY_KIND = permissionBy({
    field: "kind",
    map: {
      view: "project:view",
      update: "project:update",
      share: {
        permission: "organization:manage",
        tier: "organization",
        field: "target.organizationId",
      },
    },
  });

  function declaration(ran: unknown[]) {
    return defineRestRouter(RunsApi)
      .withNamespace("e3-dispatch")
      .withVersion(VERSION)
      .withCredential("project")
      .post("/", "trigger")
      .withInput(dispatchInput)
      .withPermission(BY_KIND)
      .withOutput(z.object({ ran: z.boolean() }))
      .handle(({ target }) => {
        ran.push(target);

        return { ran: true };
      })
      .build()
      .router();
  }

  async function dispatch(body: unknown, refuses: readonly AuthzPermission[] = []) {
    const ran: unknown[] = [];
    const { asked, identity } = door({ refuses });
    const response = await mount(declaration(ran), identity).request(
      `/api/e3-dispatch/${VERSION}/`,
      {
        method: "POST",
        headers: JSON_TYPE,
        body: JSON.stringify(body),
      },
    );

    return { asked, identity, ran, response };
  }

  describe("when the entry is the permission alone", () => {
    /** @scenario "A route chooses its permission from its parsed input" */
    it("identifies the caller, then asks the chosen permission at the credential's scope", async () => {
      const { asked, identity, ran, response } = await dispatch({ kind: "update" });

      expect(response.status).toBe(200);
      expect(identity.identify).toHaveBeenCalledTimes(1);
      expect(identity.authenticate).not.toHaveBeenCalled();
      expect(asked).toEqual([
        { permission: "project:update", target: { tier: "project", id: "project-1" } },
      ]);
      expect(ran).toEqual([null]);
    });
  });

  describe("when the entry names its own scope", () => {
    /** @scenario "A route chooses its permission from its parsed input" */
    it("asks at that scope and hands it to the handler as the target", async () => {
      const { asked, ran } = await dispatch({ kind: "share", target: { organizationId: "org-9" } });

      const scope = { tier: "organization", id: "org-9" };
      expect(asked).toEqual([{ permission: "organization:manage", target: scope }]);
      expect(ran).toEqual([scope]);
    });
  });

  describe("when the caller lacks the chosen permission", () => {
    /** @scenario "A route chooses its permission from its parsed input" */
    it("is refused 403 permission_denied, and the handler never runs", async () => {
      const { ran, response } = await dispatch({ kind: "view" }, ["project:view"]);

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ code: "permission_denied" });
      expect(ran).toEqual([]);
    });
  });

  /** @scenario "A route chooses its permission from its parsed input" */
  it("records every permission the map can ask", () => {
    mount(declaration([]), door().identity);

    expect(registered("/api/e3-dispatch/")).toMatchObject({
      policy: { permissions: ["project:view", "project:update", "organization:manage"] },
    });
  });

  /** @scenario "A route chooses its permission from its parsed input" */
  it("refuses a map that does not match its field, a tier that cannot grant, and a reach", () => {
    const route = () =>
      defineRestRouter(RunsApi)
        .withNamespace("e3-dispatch")
        .withVersion(VERSION)
        .post("/", "trigger")
        .withInput(dispatchInput)
        .withOutput(z.object({ ran: z.boolean() }));
    const handled = () => ({ ran: true });

    expect(() =>
      route()
        .withPermission(
          // @ts-expect-error the map names no permission for share
          permissionBy({ field: "kind", map: { view: "project:view", update: "project:update" } }),
        )
        .handle(handled),
    ).toThrow(/unnamed: share/);

    expect(() =>
      route()
        .withPermission({
          ...BY_KIND,
          map: {
            ...BY_KIND.map,
            view: { permission: "organization:manage", tier: "project", field: "kind" },
          },
        })
        .handle(handled),
    ).toThrow(/a tier that cannot grant it/);

    expect(() => route().withPermission(BY_KIND, { at: "grants" } as never)).toThrow(
      /takes no reach/,
    );
  });

  /** @scenario "A route chooses its permission from its parsed input" */
  it("refuses a mount whose door cannot authorize, and a browser route with no scope to ask at", () => {
    const { identity } = door();
    const { authorize: _authorize, ...unauthorizing } = identity;

    expect(() => mount(declaration([]), unauthorizing)).toThrow(/supplied no identity.authorize/);

    const browser = defineRestRouter(RunsApi)
      .withNamespace("browser-dispatch")
      .withVersion(VERSION)
      .withCredential("browser")
      .post("/", "trigger")
      .withInput(dispatchInput)
      .withPermission(BY_KIND)
      .withOutput(z.object({ ran: z.boolean() }))
      .handle(() => ({ ran: true }))
      .build()
      .router();

    expect(() =>
      createRestRuntime({ identity, doors: { browser: identity } }).mount(browser, {
        app: () => runsApp,
        onError: createErrorHandler(),
      }),
    ).toThrow(/the browser door resolves none/);
  });
});

describe("a route that asks for a named plan capability", () => {
  function declaration(ran: string[]) {
    return defineRestRouter(RunsApi)
      .withNamespace("e6-spend")
      .withVersion(VERSION)
      .withCredential("organization")
      .get("/", "trigger")
      .withPermission("organization:view")
      .withEntitlement("webhook_endpoints", { feature: "Webhook endpoints" })
      .withOutput(z.object({ ran: z.boolean() }))
      .handle(() => {
        ran.push("trigger");

        return { ran: true };
      })
      .build()
      .router();
  }

  const refusal: NonNullable<Entitlements["refusal"]> = ({ entitlement }) =>
    entitlement === "webhook_endpoints"
      ? new NoWebhookEndpointsError()
      : new Error("an entitlement this process does not refuse");

  /** @scenario "An endpoint asks whether its tenant holds a named plan capability" */
  it("asks the plan about that capability by name, at the scope access resolved", async () => {
    const ran: string[] = [];
    const holds = vi.fn(async () => true);
    const app = mount(declaration(ran), door({ caller: ORGANIZATION_CALLER }).identity, { holds });

    expect((await app.request(`/api/e6-spend/${VERSION}/`)).status).toBe(200);
    expect(holds).toHaveBeenCalledWith({
      entitlement: "webhook_endpoints",
      scope: { tier: "organization", id: "org-1" },
    });
    expect(ran).toEqual(["trigger"]);
  });

  /** @scenario "An endpoint asks whether its tenant holds a named plan capability" */
  it("refuses a tenant without it with the process's refusal for that capability", async () => {
    const ran: string[] = [];
    const app = mount(declaration(ran), door({ caller: ORGANIZATION_CALLER }).identity, {
      holds: async () => false,
      refusal,
    });

    const response = await app.request(`/api/e6-spend/${VERSION}/`);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "forbidden" });
    expect(ran).toEqual([]);
  });

  /** @scenario "An endpoint asks whether its tenant holds a named plan capability" */
  it("answers the framework's plan refusal when the process gives none", async () => {
    const app = mount(declaration([]), door({ caller: ORGANIZATION_CALLER }).identity, {
      holds: async () => false,
    });

    const response = await app.request(`/api/e6-spend/${VERSION}/`);

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({ code: "enterprise_plan_required" });
  });
});

describe("a route that declares an array body", () => {
  const steps = z.array(z.object({ index: z.number() }));

  /** @scenario "An array body's field is checked against the route's other fields where it is written" */
  it("refuses an array body naming no field, or a field its path already declares", () => {
    const route = () =>
      defineRestRouter(RunsApi)
        .withNamespace("steps")
        .withVersion(VERSION)
        .post("/:runId", "trigger")
        .withParams(z.object({ runId: z.string() }));

    expect(() => route().withInput(steps, {} as never)).toThrow(/names no field to hand it under/);
    // @ts-expect-error the field is the path's own
    expect(() => route().withInput(steps, { as: "runId" })).toThrow(
      /"runId" is declared by multiple sources/,
    );
  });
});
