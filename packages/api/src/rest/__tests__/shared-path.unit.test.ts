/**
 * A path served outside its owner's namespace for the migration (ARCHITECTURE.md §8, R10).
 * Spec: packages/api/specs/shared-path.feature.
 */
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { anyAuthenticated } from "../../access/access.ts";
import { createErrorHandler } from "../../errors.ts";
import type { RestIdentity } from "../../hosting/api-door.ts";
import { allRegisteredRoutes } from "../../route-registry.ts";
import { defineRestRouter, type RestSharedPath } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

const VERSION = "2026-10-06";
const ApiKeyDoors = moduleApi<{ visible(): { ok: boolean }; other(): { ok: boolean } }>()(
  "api-key",
);
const app = { visible: () => ({ ok: true }), other: () => ({ ok: true }) };
const SHARED: RestSharedPath = {
  owner: "project",
  reason: "the visible-projects door moved to api-key with its path unchanged",
  deprecate: "peer-cycle cut P, retired with the project REST v2",
};
const CALLER = {
  actor: { type: "api_key", id: "key-1" },
  scope: { tier: "project", id: "project-1" },
} as const;
const identity: RestIdentity = { authenticate: () => CALLER, identify: () => CALLER };

function literalFamily({ path, sharedPath }: { path: string; sharedPath?: RestSharedPath }) {
  const route = defineRestRouter(ApiKeyDoors)
    .withNamespace("api-key-shared")
    .withVersion(VERSION)
    .withAddressing("literal", { v1Twin: false })
    .get(path, "visible");
  const declared = sharedPath ? route.withSharedPath(sharedPath) : route;

  return declared
    .withAccess(anyAuthenticated({ reason: "the test door asks no permission" }))
    .withOutput(z.object({ ok: z.boolean() }))
    .handle(({ app }) => app.visible())
    .build()
    .router();
}

function mount(declaration: ReturnType<typeof literalFamily>) {
  return createRestRuntime({ identity }).mount(declaration, {
    app: () => app,
    onError: createErrorHandler(),
  });
}

function registeredAt(path: string) {
  return allRegisteredRoutes().find((route) => route.path === path);
}

describe("a route declaring a shared path", () => {
  /** @scenario "The registry lists a shared path with its owner, its server, its reason and its plan" */
  it("registers the owner, the serving module, the reason and the plan", () => {
    mount(literalFamily({ path: "/api/projects/visible-shared", sharedPath: SHARED }));
    mount(literalFamily({ path: "/api/api-keys/own-path" }));

    expect(registeredAt("/api/projects/visible-shared")?.sharedPath).toEqual({
      ...SHARED,
      servedBy: "api-key",
    });
    expect(registeredAt("/api/api-keys/own-path")?.sharedPath).toBeUndefined();
  });

  /** @scenario "A shared path that does not say why or when it goes is refused at declaration" */
  it("refuses a blank reason or a blank deprecation plan, naming the path", () => {
    expect(() =>
      literalFamily({ path: "/api/projects/no-reason", sharedPath: { ...SHARED, reason: " " } }),
    ).toThrow(/\/api\/projects\/no-reason/);
    expect(() =>
      literalFamily({ path: "/api/projects/no-plan", sharedPath: { ...SHARED, deprecate: "" } }),
    ).toThrow(/\/api\/projects\/no-plan/);
  });

  /** @scenario "A module cannot declare a shared path with itself" */
  it("refuses at mount a shared path whose owner is the serving module", () => {
    const declaration = literalFamily({
      path: "/api/api-keys/self-shared",
      sharedPath: { ...SHARED, owner: "api-key" },
    });

    expect(() => mount(declaration)).toThrow(/\/api\/api-keys\/self-shared of api-key/);
    expect(registeredAt("/api/api-keys/self-shared")).toBeUndefined();
  });

  /** @scenario "A shared path lives only in a literal or a dated family" */
  it("refuses at mount a shared path in a v1-only family", () => {
    const declaration = defineRestRouter(ApiKeyDoors)
      .withNamespace("projects")
      .withVersion(VERSION)
      .withAddressing("v1-only")
      .get("/v1-shared", "visible")
      .withSharedPath(SHARED)
      .withAccess(anyAuthenticated({ reason: "the test door asks no permission" }))
      .withOutput(z.object({ ok: z.boolean() }))
      .handle(({ app }) => app.visible())
      .build()
      .router();

    expect(() => mount(declaration)).toThrow(/"v1-only" family.*literal or a dated family/);
  });

  /** @scenario "A dated family that both owns and shares its namespace is refused at mount" */
  it("refuses at mount a dated family where one route shares and another does not", () => {
    const declaration = defineRestRouter(ApiKeyDoors)
      .withNamespace("projects")
      .withVersion(VERSION)
      .get("/dated-shared", "visible")
      .withSharedPath(SHARED)
      .withAccess(anyAuthenticated({ reason: "the test door asks no permission" }))
      .withOutput(z.object({ ok: z.boolean() }))
      .handle(({ app }) => app.visible())
      .get("/dated-owned", "other")
      .withAccess(anyAuthenticated({ reason: "the test door asks no permission" }))
      .withOutput(z.object({ ok: z.boolean() }))
      .handle(({ app }) => app.other())
      .build()
      .router();

    expect(() => mount(declaration)).toThrow(
      /dated family "projects" of api-key both owns and shares a namespace.*family of their own/,
    );
  });

  /** @scenario "A dated family that both owns and shares its namespace is refused at mount" */
  it("refuses at mount a dated family whose routes name different owners", () => {
    const declaration = defineRestRouter(ApiKeyDoors)
      .withNamespace("projects")
      .withVersion(VERSION)
      .get("/owner-one", "visible")
      .withSharedPath(SHARED)
      .withAccess(anyAuthenticated({ reason: "the test door asks no permission" }))
      .withOutput(z.object({ ok: z.boolean() }))
      .handle(({ app }) => app.visible())
      .get("/owner-two", "other")
      .withSharedPath({ ...SHARED, owner: "dataset" })
      .withAccess(anyAuthenticated({ reason: "the test door asks no permission" }))
      .withOutput(z.object({ ok: z.boolean() }))
      .handle(({ app }) => app.other())
      .build()
      .router();

    expect(() => mount(declaration)).toThrow(
      /both owns and shares a namespace \(project, dataset\)/,
    );
  });
});
