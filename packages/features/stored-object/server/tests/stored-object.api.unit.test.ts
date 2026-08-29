import { createService, type MountedRoute } from "@langwatch/api/rest";
import type {
  StoredObjectOwnerResolver,
  StoredObjectService as StoredObjectServiceContract,
} from "@langwatch/stored-object-contract";
import { describe, expect, it } from "vitest";
import { StoredObjectApp, StoredObjectsPublicApi } from "../src";
import type { StoredObjectFileReadPort } from "../src";

describe("StoredObjectsPublicApi", () => {
  it("registers one rate-limited RPC family with explicit permissions", () => {
    const mounted: MountedRoute[] = [];
    const application = StoredObjectApp.create({
      storedObjects: {} as StoredObjectServiceContract,
      files: {} as StoredObjectFileReadPort,
      owners: {} as StoredObjectOwnerResolver,
    });
    const builder = createService<
      unknown,
      {
        storedObjects: StoredObjectApp;
      }
    >({
      name: "stored-objects",
      basePath: "/api/stored-objects",
      app: () => ({ storedObjects: application }),
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

    const routes = mounted.filter((route) => !route.isNamespaceGuard);
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
