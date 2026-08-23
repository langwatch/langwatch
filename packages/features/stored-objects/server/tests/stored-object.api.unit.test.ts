import { createService, type MountedRoute } from "@langwatch/api";
import type { StoredObjectsService as StoredObjectsServiceContract } from "@langwatch/stored-objects-contract";
import { describe, expect, it } from "vitest";
import { StoredObjectsPublicApi } from "../src";

describe("StoredObjectsPublicApi", () => {
  it("registers one rate-limited RPC family with explicit permissions", () => {
    const mounted: MountedRoute[] = [];
    const service = {} as StoredObjectsServiceContract;
    const builder = createService({
      name: "stored-objects",
      basePath: "/api/stored-objects",
      onRouteMounted: (route) => mounted.push(route),
      rateLimiter: {
        async check() {
          return { allowed: true };
        },
      },
      permissionEnforcer: () => async (_context, next) => next(),
    });

    StoredObjectsPublicApi.create({
      service: () => service,
      maximumUploadBytes: 1024,
      projectId: () => "project_1",
      authorizeAudience: async () => undefined,
    })
      .install(builder)
      .build();

    const routes = mounted.filter(
      (route) => !route.isNamespaceGuard && !route.isDiscoverEndpoint,
    );
    const latest = routes.filter((route) => route.version === "latest");
    expect(
      latest.map((route) => ({
        path: route.path,
        permission: route.config?.permission,
        rateLimit: route.config?.rateLimit,
      })),
    ).toEqual([
      {
        path: "/api/stored-objects/latest/storedObjects.createUpload",
        permission: "project:update",
        rateLimit: true,
      },
      {
        path: "/api/stored-objects/latest/storedObjects.confirmUpload",
        permission: "project:update",
        rateLimit: true,
      },
      {
        path: "/api/stored-objects/latest/storedObjects.get",
        permission: "project:view",
        rateLimit: true,
      },
      {
        path: "/api/stored-objects/latest/storedObjects.delete",
        permission: "project:manage",
        rateLimit: true,
      },
    ]);
  });
});
