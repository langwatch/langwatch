/**
 * The credential class a route publishes follows the door its family is mounted behind, never a
 * label written by hand. Spec: specs/security/api-endpoint-authorization.feature.
 */

import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createApiDouble } from "../../__tests__/api-double.ts";
import { deferredScope } from "../../access/index.ts";
import { createErrorHandler } from "../../errors.ts";
import { getRoutePolicy } from "../../route-registry.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

interface ProbeApi {
  read(): Promise<{ id: string }>;
}

const ProbeApi = moduleApi<ProbeApi>()("annotation");
const VERSION = "2026-09-08";

const projectFamily = defineRestRouter(ProbeApi)
  .withNamespace("class-probe-project")
  .withVersion(VERSION)
  .withAddressing("v1-only")
  .withCredential("project")
  .get("/", "readProject")
  .withPermission("traces:view")
  .withOutput(z.object({ id: z.string() }))
  .handle(async ({ app }) => app.read())
  .build();

const organizationFamily = defineRestRouter(ProbeApi)
  .withNamespace("class-probe-organization")
  .withVersion(VERSION)
  .withAddressing("v1-only")
  .withCredential("organization")
  .get("/", "readOrganization")
  .withPermission("organization:manage")
  .withOutput(z.object({ id: z.string() }))
  .handle(async ({ app }) => app.read())
  .build();

const sessionFamily = defineRestRouter(ProbeApi)
  .withNamespace("class-probe-session")
  .withVersion(VERSION)
  .withAddressing("v1-only")
  .withCredential("browser")
  .get("/", "readSession")
  .withAccess(deferredScope({ reason: "the handler finds the owning project" }))
  .withOutput(z.object({ id: z.string() }))
  .handle(async ({ app }) => app.read())
  .build();

function mountAll(): void {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: { tier: "project", id: "project-1" } }),
      identify: () => ({ actor: null, scope: null }),
      authorize: () => ({ permitted: true, organizationRole: null }),
    },
  });
  const app = () => createApiDouble<ProbeApi>({ read: async () => ({ id: "p" }) });

  for (const declaration of [projectFamily, organizationFamily, sessionFamily]) {
    runtime.mount(declaration.router(), { app, onError: createErrorHandler() });
  }
}

describe("the credential class a mounted route publishes", () => {
  /** @scenario "A route publishes the credential class it actually enforces" */
  it("follows the door of the family each route is mounted on", () => {
    mountAll();

    const classOf = (family: string) =>
      getRoutePolicy("get", `/api/v1/${family}`)?.credentialClass ??
      getRoutePolicy("get", `/api/${family}/${VERSION}`)?.credentialClass;

    expect(classOf("class-probe-project")).toBe("project_api_key");
    expect(classOf("class-probe-organization")).toBe("organization_api_key");
    expect(classOf("class-probe-session")).toBe("session");
  });
});
