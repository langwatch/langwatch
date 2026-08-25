import { createService, type MountedRoute } from "@langwatch/api";
import type { StoredObjectService as StoredObjectServiceContract } from "@langwatch/stored-object-contract";
import { describe, expect, it } from "vitest";
import { StoredObjectsPublicApi } from "../src";

describe("StoredObjectsPublicApi", () => {
  it("registers one rate-limited RPC family with explicit permissions", () => {
    const mounted: MountedRoute[] = [];
    const service = {} as StoredObjectServiceContract;
    const builder = createService<
      unknown,
      {
        storedObjects: StoredObjectServiceContract;
      }
    >({
      name: "stored-objects",
      basePath: "/api/stored-objects",
      app: () => ({ storedObjects: service }),
      authorize: async () => undefined,
      onRouteMounted: (route) => mounted.push(route),
      rateLimiter: {
        async check() {
          return { allowed: true };
        },
      },
      permissionEnforcer: () => async (_context, next) => next(),
    });

    StoredObjectsPublicApi.create({
      maximumUploadBytes: 1024,
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
