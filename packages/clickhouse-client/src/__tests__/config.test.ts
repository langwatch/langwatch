import { describe, expect, it } from "vitest";
import {
  ClickHouseConfigService,
  DuplicatePrivateClickHouseRouteError,
  InvalidClickHouseConfigurationError,
} from "../config";

describe("ClickHouseConfigService", () => {
  it("resolves typed process configuration without reading ambient environment", () => {
    const configuration = ClickHouseConfigService.create().resolve({
      shared: { url: "http://shared:8123", cluster: "shared" },
      privateRoutes: [{ organizationId: "org-1", url: "http://private:8123", cluster: "acme" }],
      poolSizing: { replicas: 10 },
    });

    expect(configuration.shared).toEqual({ url: "http://shared:8123", cluster: "shared" });
    expect(configuration.privateRoutes.get("org-1")).toEqual({
      organizationId: "org-1",
      url: "http://private:8123",
      cluster: "acme",
    });
    expect(configuration.poolSizing).toMatchObject({ size: 21, source: "derived" });
  });

  it("refuses a duplicate private route rather than selecting an endpoint arbitrarily", () => {
    expect(() =>
      ClickHouseConfigService.create().resolve({
        privateRoutes: [
          { organizationId: "org-1", url: "http://one:8123", cluster: "one" },
          { organizationId: "org-1", url: "http://two:8123", cluster: "two" },
        ],
      }),
    ).toThrow(DuplicatePrivateClickHouseRouteError);
  });

  it("refuses empty endpoint fields before any client can be constructed", () => {
    expect(() =>
      ClickHouseConfigService.create().resolve({
        shared: { url: "", cluster: "shared" },
      }),
    ).toThrow(InvalidClickHouseConfigurationError);
  });
});
