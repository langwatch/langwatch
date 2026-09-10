/**
 * Declared families the document tests describe. Real declarations built with
 * `defineRestRouter`, because the whole point of the generator is that a
 * declaration is its only input: a hand-written stand-in would prove nothing
 * about what a family actually publishes.
 */
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/runtime-composition";
import { z } from "zod";

import type { DeclaredRestFamily } from "../openapi-document.declarations.ts";

interface FixtureApi {
  readonly noop: () => void;
}

/**
 * A real installed module name, because `moduleApi` validates it against the
 * generated list. Which one is immaterial: the document reads a declaration's
 * namespace, credential and routes, never its Api token.
 */
const FixtureApi = moduleApi<FixtureApi>("annotation");

const identified = z.object({ id: z.string() });
const answer = z.object({ id: z.string(), name: z.string() });

/** One built descriptor, as a module hands it to the installer. */
type RestDescriptor = Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => unknown;
}>;

/** The family, its descriptor and its declaration, ready for either seam. */
export type FixtureFamily = DeclaredRestFamily & { readonly descriptor: RestDescriptor };

function familyOf({ module, descriptor }: { module: string; descriptor: RestDescriptor }): FixtureFamily {
  return {
    module,
    descriptor,
    declaration: descriptor.router() as DeclaredRestFamily["declaration"],
  };
}

const widgets = defineRestRouter(FixtureApi)
  .withNamespace("widgets")
  .withVersion(MANAGEMENT_API_VERSION)

  .get("/", "listWidgets")
  .withPermission("widgets:view")
  .withOutput(z.object({ data: z.array(answer) }))
  .withDocs({ summary: "List widgets" })
  .handle(async () => ({ data: [] }))

  .get("/:id", "getWidget")
  .withParams(identified)
  .withPermission("widgets:view")
  .withOutput(answer)
  .withDocs({ summary: "Get one widget" })
  .handle(async ({ input }) => ({ id: input.id, name: "one" }))

  .post("/", "createWidget")
  .withInput(z.object({ name: z.string() }))
  .withPermission("widgets:manage")
  .withOutput(answer)
  .handle(async ({ input }) => ({ id: "widget-1", name: input.name }))
  .build();

/** A second family claiming the same namespace, for the collision refusal. */
const widgetTwin = defineRestRouter(FixtureApi)
  .withNamespace("widgets")
  .withVersion(MANAGEMENT_API_VERSION)

  .get("/", "listWidgetsAgain")
  .withPermission("widgets:view")
  .withOutput(z.object({ data: z.array(answer) }))
  .handle(async () => ({ data: [] }))
  .build();

const tenants = defineRestRouter(FixtureApi)
  .withNamespace("tenants")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organization")

  .get("/", "listTenants")
  .withPermission("organization:view")
  .withOutput(z.object({ data: z.array(answer) }))
  .handle(async () => ({ data: [] }))
  .build();

const relay = defineRestRouter(FixtureApi)
  .withNamespace("relay")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("internalSecret")

  .post("/dispatch", "dispatchRelay")
  .withInput(z.object({ payload: z.string() }))
  .withPermission("relay:manage")
  .withOutput(z.object({ accepted: z.boolean() }))
  .handle(async () => ({ accepted: true }))
  .build();

const health = defineRestRouter(FixtureApi)
  .withNamespace("health")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .get("/api/health/live", "readLiveness")
  .withPermission("health:view")
  .withOutput(z.object({ ok: z.boolean() }))
  .handle(async () => ({ ok: true }))
  .build();

const legacy = defineRestRouter(FixtureApi)
  .withNamespace("legacy")
  .withVersion(MANAGEMENT_API_VERSION)

  .get("/current", "readCurrent")
  .withPermission("legacy:view")
  .withOutput(answer)
  .handle(async () => ({ id: "current", name: "current" }))

  .get("/retired", "readRetired")
  .withPermission("legacy:view")
  .withOutput(answer)
  .withDocs({ hide: true })
  .handle(async () => ({ id: "retired", name: "retired" }))
  .build();

const console_ = defineRestRouter(FixtureApi)
  .withNamespace("console")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("browser")

  .get("/", "readConsole")
  .withPermission("console:view")
  .withOutput(answer)
  .handle(async () => ({ id: "console", name: "console" }))
  .build();

const mixed = defineRestRouter(FixtureApi)
  .withNamespace("mixed")
  .withVersion(MANAGEMENT_API_VERSION)

  .get("/open", "readOpen")
  .withPermission("mixed:view")
  .withOutput(answer)
  .handle(async () => ({ id: "open", name: "open" }))

  .get("/session", "readSession")
  .withCredential("browser")
  .withPermission("mixed:view")
  .withOutput(answer)
  .handle(async () => ({ id: "session", name: "session" }))
  .build();

/** Three routes behind a project key: a list, a read and a create. */
export const projectFamily = familyOf({ module: "widget", descriptor: widgets });

/** The same namespace declared twice, so one published address has two owners. */
export const projectFamilyTwin = familyOf({ module: "widget-twin", descriptor: widgetTwin });

/** One route behind an organization key. */
export const organizationFamily = familyOf({ module: "tenant", descriptor: tenants });

/** One route behind the deployment's own shared secret. */
export const internalDoorFamily = familyOf({ module: "relay", descriptor: relay });

/** A family whose route paths are its whole addresses. */
export const literalFamily = familyOf({ module: "platform-health", descriptor: health });

/** Two routes, one of which its declaration keeps out of the document. */
export const hiddenRouteFamily = familyOf({ module: "legacy", descriptor: legacy });

/** A family a browser session reaches, which no API client can present. */
export const browserFamily = familyOf({ module: "console", descriptor: console_ });

/** A published family holding one route that raises a browser door itself. */
export const routeRaisedBrowserDoorFamily = familyOf({ module: "mixed", descriptor: mixed });
