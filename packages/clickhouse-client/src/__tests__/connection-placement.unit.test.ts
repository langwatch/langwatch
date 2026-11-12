/**
 * What the routed connection reports as a tenant's placement for the LangWatchQL gate (ADR-200):
 * the organisation or `shared` it resolves to, what was recorded, and a credential-free origin.
 * Spec: specs/lwql/isolation.feature
 */
import { describe, expect, it, vi } from "vitest";

import { ClickHouseConfigService } from "../config.ts";
import {
  ClickHouseClientFactory,
  ClickHouseConnectionClosedError,
  ClickHouseConnectionService,
  type ClickHouseCloseableClient,
} from "../connection.ts";

class StubClientFactory extends ClickHouseClientFactory<ClickHouseCloseableClient> {
  create(): ClickHouseCloseableClient {
    return { close: vi.fn(async () => undefined) };
  }
}

const ORGANIZATION_OF: Readonly<Record<string, string>> = {
  "project-routed": "org-routed",
  "project-shared": "org-shared",
  "project-recorded": "org-recorded",
};

function connect({ withShared = true }: { withShared?: boolean } = {}) {
  return ClickHouseConnectionService.create({
    directory: {
      organizationForTenant: async (tenantId) => ORGANIZATION_OF[tenantId] ?? null,
      recordedPrivateDataplaneOf: async (organizationId) => ({
        clickhouseLabel: ["org-routed", "org-recorded"].includes(organizationId) ? "own" : null,
        s3Label: null,
      }),
    },
    clientFactory: new StubClientFactory(),
  }).connect(
    ClickHouseConfigService.create().resolve({
      shared: withShared ? { url: "http://shared:8123", cluster: "shared" } : undefined,
      privateRoutes: [
        {
          organizationId: "org-routed",
          url: "https://reader:s3cret@routed.example:8443/langwatch",
          cluster: "routed",
        },
      ],
      poolSizing: { override: 1 },
    }),
  );
}

describe("ClickHouseConnection.placementOf", () => {
  describe("given a tenant whose organisation has its own route", () => {
    it("reports that organisation as the target and the route's origin without its credentials", async () => {
      expect(await connect().placementOf("project-routed")).toEqual({
        target: "org-routed",
        recordedPrivate: true,
        origin: "https://routed.example:8443",
      });
    });
  });

  describe("given a tenant on the shared server", () => {
    it("reports the shared target and the shared server's origin", async () => {
      expect(await connect().placementOf("project-shared")).toEqual({
        target: "shared",
        recordedPrivate: false,
        origin: "http://shared:8123",
      });
    });
  });

  describe("given a tenant recorded private that this process has no route for", () => {
    it("reports the disagreement and leaves the refusal to the caller", async () => {
      expect(await connect().placementOf("project-recorded")).toEqual({
        target: "shared",
        recordedPrivate: true,
        origin: "http://shared:8123",
      });
    });
  });

  describe("given a process with no shared server", () => {
    it("reports no origin for a tenant it would resolve there", async () => {
      expect(await connect({ withShared: false }).placementOf("project-shared")).toEqual({
        target: "shared",
        recordedPrivate: false,
        origin: null,
      });
    });
  });

  describe("given a connection that has started closing", () => {
    it("refuses rather than answer from a closed router", async () => {
      const connection = connect();
      await connection.closeOnce();

      await expect(connection.placementOf("project-shared")).rejects.toBeInstanceOf(
        ClickHouseConnectionClosedError,
      );
    });
  });
});
