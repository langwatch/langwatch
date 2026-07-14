import { describe, it, expect } from "vitest";

import type { EndpointRegistration } from "../types.js";
import { isDateVersion } from "../types.js";
import {
  resolveVersions,
  resolveRequestVersion,
  type VersionDefinition,
} from "../versioning.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEndpoint(
  overrides: Partial<EndpointRegistration> = {},
): EndpointRegistration {
  return {
    method: "get",
    path: "/items",
    config: {} as EndpointRegistration["config"],
    handler: () => ({ ok: true }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// resolveVersions
// ---------------------------------------------------------------------------

describe("resolveVersions", () => {
  describe("when a version is invalid or duplicated", () => {
    it("rejects invalid calendar dates", () => {
      expect(() =>
        resolveVersions(
          [{ version: "2025-02-30", endpoints: [makeEndpoint()] }],
          [],
        ),
      ).toThrow(/Invalid API version/);
    });

    it("rejects duplicate version definitions", () => {
      expect(() =>
        resolveVersions(
          [
            { version: "2025-03-15", endpoints: [makeEndpoint()] },
            { version: "2025-03-15", endpoints: [makeEndpoint()] },
          ],
          [],
        ),
      ).toThrow(/registered more than once/);
    });
  });

  describe("when given a single version", () => {
    it("resolves the version and creates a latest alias", () => {
      const definitions: VersionDefinition[] = [
        { version: "2025-03-15", endpoints: [makeEndpoint()] },
      ];

      const result = resolveVersions(definitions, []);

      expect(result.has("2025-03-15")).toBe(true);
      expect(result.has("latest")).toBe(true);
      expect(result.get("2025-03-15")).toHaveLength(1);
      expect(result.get("latest")).toEqual(result.get("2025-03-15"));
    });
  });

  describe("when given multiple versions", () => {
    it("forward-copies endpoints from v1 to v2", () => {
      const getItems = makeEndpoint({ method: "get", path: "/items" });
      const postItems = makeEndpoint({ method: "post", path: "/items" });
      const getDetails = makeEndpoint({ method: "get", path: "/details" });

      const definitions: VersionDefinition[] = [
        { version: "2025-01-01", endpoints: [getItems, postItems] },
        { version: "2025-06-01", endpoints: [getDetails] },
      ];

      const result = resolveVersions(definitions, []);

      // v1 has 2 endpoints
      expect(result.get("2025-01-01")).toHaveLength(2);

      // v2 has 3 endpoints (2 inherited + 1 new)
      expect(result.get("2025-06-01")).toHaveLength(3);

      // latest points to v2
      expect(result.get("latest")).toEqual(result.get("2025-06-01"));
    });

    it("overrides an endpoint when re-registered in a later version", () => {
      const v1Handler = () => ({ version: 1 });
      const v2Handler = () => ({ version: 2 });

      const definitions: VersionDefinition[] = [
        {
          version: "2025-01-01",
          endpoints: [
            makeEndpoint({ method: "get", path: "/items", handler: v1Handler }),
          ],
        },
        {
          version: "2025-06-01",
          endpoints: [
            makeEndpoint({ method: "get", path: "/items", handler: v2Handler }),
          ],
        },
      ];

      const result = resolveVersions(definitions, []);

      // v1 has the original handler
      const v1Endpoints = result.get("2025-01-01")!;
      expect(v1Endpoints).toHaveLength(1);
      const v1Active = v1Endpoints[0]!;
      expect(v1Active.withdrawn).not.toBe(true);
      if (!v1Active.withdrawn) {
        expect(v1Active.handler).toBe(v1Handler);
      }

      // v2 has the new handler
      const v2Endpoints = result.get("2025-06-01")!;
      expect(v2Endpoints).toHaveLength(1);
      const v2Active = v2Endpoints[0]!;
      expect(v2Active.withdrawn).not.toBe(true);
      if (!v2Active.withdrawn) {
        expect(v2Active.handler).toBe(v2Handler);
      }
    });

    it("treats an empty root path and slash root path as the same endpoint", () => {
      const rootHandler = () => ({ version: 1 });
      const replacementHandler = () => ({ version: 2 });
      const definitions: VersionDefinition[] = [
        {
          version: "2025-01-01",
          endpoints: [makeEndpoint({ path: "", handler: rootHandler })],
        },
        {
          version: "2025-06-01",
          endpoints: [makeEndpoint({ path: "/", handler: replacementHandler })],
        },
      ];

      const result = resolveVersions(definitions, []);
      const endpoints = result.get("2025-06-01")!;

      expect(endpoints).toHaveLength(1);
      const endpoint = endpoints[0]!;
      expect(endpoint.withdrawn).not.toBe(true);
      if (!endpoint.withdrawn) {
        expect(endpoint.handler).toBe(replacementHandler);
      }
    });
  });

  describe("when an endpoint is withdrawn", () => {
    it("marks the endpoint as withdrawn in the version", () => {
      const definitions: VersionDefinition[] = [
        {
          version: "2025-01-01",
          endpoints: [makeEndpoint({ method: "get", path: "/items" })],
        },
        {
          version: "2025-06-01",
          endpoints: [
            {
              method: "get",
              path: "/items",
              config: {} as EndpointRegistration["config"],
              handler: () => {},
              withdrawn: true,
            },
          ],
        },
      ];

      const result = resolveVersions(definitions, []);

      // v1 is active
      const v1Ep = result.get("2025-01-01")![0]!;
      expect(v1Ep.withdrawn).not.toBe(true);

      // v2 is withdrawn
      const v2Ep = result.get("2025-06-01")![0]!;
      expect(v2Ep.withdrawn).toBe(true);
    });
  });

  describe("when preview endpoints are provided", () => {
    it("stores them under the preview key", () => {
      const definitions: VersionDefinition[] = [
        { version: "2025-01-01", endpoints: [makeEndpoint()] },
      ];
      const previewEndpoints = [
        makeEndpoint({ method: "post", path: "/beta" }),
      ];

      const result = resolveVersions(definitions, previewEndpoints);

      expect(result.has("preview")).toBe(true);
      expect(result.get("preview")).toHaveLength(1);
    });

    it("keeps preview endpoints separate from latest", () => {
      const definitions: VersionDefinition[] = [
        { version: "2025-01-01", endpoints: [makeEndpoint()] },
      ];
      const previewEndpoints = [
        makeEndpoint({ method: "post", path: "/beta" }),
      ];

      const result = resolveVersions(definitions, previewEndpoints);

      const latest = result.get("latest")!;
      const preview = result.get("preview")!;

      // Latest should only have the v1 endpoint
      expect(latest).toHaveLength(1);
      // Preview should only have the beta endpoint
      expect(preview).toHaveLength(1);
    });

    it("normalizes GET and SSE keys when de-duplicating preview endpoints", () => {
      const previewEndpoints = [
        makeEndpoint({ method: "get", path: "/stream" }),
        makeEndpoint({ method: "sse", path: "/stream" }),
      ];

      const result = resolveVersions([], previewEndpoints);

      expect(result.get("preview")).toHaveLength(1);
      expect(result.get("preview")?.[0]?.method).toBe("sse");
    });

    it("preserves preview withdrawals as 410 markers", () => {
      const previewEndpoints = [
        makeEndpoint({ method: "get", path: "/beta" }),
        makeEndpoint({
          method: "get",
          path: "/beta",
          withdrawn: true,
        }),
      ];

      const result = resolveVersions([], previewEndpoints);

      expect(result.get("preview")).toEqual([
        expect.objectContaining({ path: "/beta", withdrawn: true }),
      ]);
    });
  });

  describe("when versions are provided out of order", () => {
    it("sorts them chronologically", () => {
      const v2Handler = () => ({ latest: true });
      const definitions: VersionDefinition[] = [
        {
          version: "2025-06-01",
          endpoints: [makeEndpoint({ handler: v2Handler })],
        },
        { version: "2025-01-01", endpoints: [makeEndpoint()] },
      ];

      const result = resolveVersions(definitions, []);

      // Latest should be v2
      const latestEp = result.get("latest")![0]!;
      expect(latestEp.withdrawn).not.toBe(true);
      if (!latestEp.withdrawn) {
        expect(latestEp.handler).toBe(v2Handler);
      }
    });
  });
});

describe("isDateVersion", () => {
  it("accepts real dates and rejects impossible calendar dates", () => {
    expect(isDateVersion("2024-02-29")).toBe(true);
    expect(isDateVersion("2025-02-29")).toBe(false);
    expect(isDateVersion("2025-13-01")).toBe(false);
    expect(isDateVersion("v1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveRequestVersion
// ---------------------------------------------------------------------------

describe("resolveRequestVersion", () => {
  const definitions: VersionDefinition[] = [
    { version: "2025-01-01", endpoints: [makeEndpoint()] },
    {
      version: "2025-06-01",
      endpoints: [makeEndpoint({ method: "post", path: "/new" })],
    },
  ];
  const previewEndpoints = [makeEndpoint({ method: "get", path: "/beta" })];
  const versionMap = resolveVersions(definitions, previewEndpoints);

  describe("when an exact dated version is requested", () => {
    it("returns the version with stable status", () => {
      const result = resolveRequestVersion(versionMap, "2025-01-01");
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.version).toBe("2025-01-01");
        expect(result.status).toBe("stable");
      }
    });
  });

  describe("when latest is requested", () => {
    it("returns the newest dated version with latest status", () => {
      const result = resolveRequestVersion(versionMap, "latest");
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.version).toBe("latest");
        expect(result.status).toBe("latest");
        // Should have endpoints from both versions (forward-copied)
        expect(result.endpoints.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe("when preview is requested", () => {
    it("returns preview endpoints with preview status", () => {
      const result = resolveRequestVersion(versionMap, "preview");
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.version).toBe("preview");
        expect(result.status).toBe("preview");
      }
    });
  });

  describe("when no version is provided (bare path)", () => {
    it("returns latest with unversioned status", () => {
      const result = resolveRequestVersion(versionMap, undefined);
      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.status).toBe("unversioned");
      }
    });
  });

  describe("when an unknown version is requested", () => {
    it("returns not found", () => {
      const result = resolveRequestVersion(versionMap, "2099-01-01");
      expect(result.found).toBe(false);
    });
  });

  describe("when a non-date string is requested", () => {
    it("returns not found", () => {
      const result = resolveRequestVersion(versionMap, "v1");
      expect(result.found).toBe(false);
    });
  });
});
