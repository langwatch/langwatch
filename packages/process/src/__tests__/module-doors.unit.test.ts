import { anyAuthenticated } from "@langwatch/api/access";
import { defineRestDoor, defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineProcessModule, type FeatureSetup } from "../feature-installer.ts";

interface OwnApi {
  read(): string;
}
const OwnApi = moduleApi<OwnApi>()("licensing");
const PeerApi = moduleApi<OwnApi>()("workflow");
const UnreachableApi = moduleApi<OwnApi>()("trace");

const ACCESS = anyAuthenticated({ reason: "the module doors fixture" });

const routes = defineRestRouter(OwnApi)
  .withNamespace("module-doors")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("licence_token")
  .get("/api/module-doors/v1/licence", "moduleDoorsLicence")
  .withAccess(ACCESS)
  .withOutput(z.object({ value: z.string() }))
  .handle(({ app }) => ({ value: app.read() }))
  .get("/api/module-doors/v1/ingest", "moduleDoorsIngest")
  .withCredential("otlp_ingest")
  .withAccess(ACCESS)
  .withOutput(z.object({ value: z.string() }))
  .handle(({ app }) => ({ value: app.read() }))
  .build();

class OwnApp {
  static readonly contract = OwnApi;
  static readonly dependencies = { workflows: PeerApi };
  static create(_setup: FeatureSetup<typeof OwnApp.dependencies, undefined>) {
    return { read: () => "own" };
  }
}

const licenceDoor = defineRestDoor("licence_token", {
  needs: OwnApi,
  identify: async () => ({ scope: { tier: "organization", id: "organization-1" } }),
});
const otlpDoor = defineRestDoor("otlp_ingest", {
  needs: PeerApi,
  identify: async () => ({ scope: { tier: "project", id: "project-1" } }),
});
const scimDoor = defineRestDoor("scim_token", {
  needs: OwnApi,
  identify: async () => ({ scope: { tier: "organization", id: "organization-1" } }),
});
const unreachableDoor = defineRestDoor("otlp_ingest", {
  needs: UnreachableApi,
  identify: async () => ({ scope: { tier: "project", id: "project-1" } }),
});

const transports = () => defineProcessModule("licensing").withApi(OwnApp).withTransports(routes);

describe("a module binding the doors its routes name", () => {
  /** @scenario "A module's doors must match the credentials its routes name" */
  it("compiles only with exactly those credentials, each needing an Api it can reach", () => {
    const bound = transports().withDoors({ licence_token: licenceDoor, otlp_ingest: otlpDoor });

    // @ts-expect-error otlp_ingest is named by a route and missing
    transports().withDoors({ licence_token: licenceDoor });
    const extra = { licence_token: licenceDoor, otlp_ingest: otlpDoor, scim_token: scimDoor };
    // @ts-expect-error scim_token is named by no route
    transports().withDoors(extra);
    // @ts-expect-error the licence_token key holds a door of another credential
    transports().withDoors({ licence_token: otlpDoor, otlp_ingest: otlpDoor });
    // @ts-expect-error the trace Api is neither this module's nor a declared peer's
    transports().withDoors({ licence_token: licenceDoor, otlp_ingest: unreachableDoor });

    expect(bound.name).toBe("licensing");
  });
});
