/**
 * A proof-bearing route the door cannot mint a proof for is refused 403 before its handler.
 * Ruling TRACE-PROOF-DOOR-REFUSES (2026-10-09); ADR-166.
 */
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";

import { createErrorHandler } from "../../errors.ts";
import { CliTokenIdentity } from "../cli-token-identity.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

type ReadsApi = { read(): Promise<{ found: boolean }> };

const ReadsApi = moduleApi<ReadsApi>()("trace");
const VERSION = "2026-10-06";

describe("a proof-bearing route", () => {
  describe("when the door admits the caller at a scope it cannot mint a proof for", () => {
    it("answers 403 permission_denied and never runs the handler", async () => {
      const ran: string[] = [];
      const door = CliTokenIdentity.create({
        verify: async () => ({ userId: "user-1", organizationId: "org-1" }),
        permitted: () => ({ permitted: true, organizationRole: null }),
      });
      const routes = defineRestRouter(ReadsApi)
        .withNamespace("proof-reads")
        .withVersion(VERSION)
        .withCredential("cli_token")
        .get("/", "read")
        .withPermission("traces:view")
        .handle(async ({ app }) => {
          await app.read();
        })
        .build()
        .router();
      const app: ReadsApi = {
        read: async () => {
          ran.push("read");

          return { found: true };
        },
      };

      const response = await createRestRuntime({ identity: door, doors: { cli_token: door } })
        .mount(routes, { app: () => app, onError: createErrorHandler() })
        .request(`/api/proof-reads/${VERSION}/`, {
          headers: { authorization: "Bearer lw_at_live" },
        });

      expect(response.status).toBe(403);
      expect(await response.text()).toContain("permission_denied");
      expect(ran).toEqual([]);
    });
  });
});
