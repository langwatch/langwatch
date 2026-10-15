/** @vitest-environment node */

import { moduleApi } from "@langwatch/module";
import type * as Observability from "@langwatch/observability";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { anyAuthenticated } from "../../access/access.ts";
import { setLedgerCurrent } from "../../errors.ts";
import { MANAGEMENT_API_VERSION } from "../addressing.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { defineRestRouter } from "../declaration.ts";
import { RestHost } from "../host.ts";
import { bindRestCredential } from "../request.ts";

const logged = vi.hoisted(() => ({ errors: [] as string[], infos: [] as string[] }));

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof Observability>();
  return {
    ...actual,
    createLogger: (name: string) =>
      Object.assign(Object.create(actual.createLogger(name)), {
        error: (_fields: unknown, message: string) => logged.errors.push(message),
        info: (_fields: unknown, message: string) => logged.infos.push(message),
      }),
  };
});

const Api = moduleApi<{ read(): { ok: boolean } }>()("langy");
const declaration = defineRestRouter(Api)
  .withNamespace("internal")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("internal_secret")
  .get("/internal/read", "internal")
  .withAccess(anyAuthenticated({ reason: "module-owned internal credential" }))
  .withOutput(z.object({ ok: z.boolean() }))
  .handle(({ app }) => app.read())
  .build();

function hostReading(read: () => { ok: boolean }) {
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
  const host = RestHost.create({
    authz: authorizationPort.forRequest(),
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      instance_admin: closed,
      browser: closed,
    },
    audit: { record: async () => {} },
  });
  host.mount(declaration.router(), () => ({ read }), {
    middlewareBindings: [
      bindRestCredential("internal_secret", () =>
        BearerIdentity.create({ name: "internal", token: "internal-marker" }),
      ),
    ],
  });
  return host;
}

const headers = { authorization: "Bearer internal-marker" };

/** Prisma's P2022: the column this code reads is not in the schema yet. */
const columnAhead = () =>
  Object.assign(new Error("column `Organization.kind` does not exist"), { code: "P2022" });

describe("a REST read ahead of the schema", () => {
  beforeEach(() => {
    logged.errors.length = 0;
    logged.infos.length = 0;
  });

  describe("given the worker is still upgrading the schema", () => {
    beforeEach(() => setLedgerCurrent({ current: false }));

    /** @scenario "A read ahead of the schema while upgrading logs no error" */
    it("answers upgrade_in_progress and logs no error", async () => {
      const host = hostReading(() => {
        throw columnAhead();
      });

      const response = await host.app.request("/internal/read", { headers });

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "upgrade_in_progress" });
      expect(logged.errors).toEqual([]);
    });
  });

  describe("given the ledger is current for this image", () => {
    afterEach(() => setLedgerCurrent({ current: false }));

    it("still logs the disagreement as an error", async () => {
      setLedgerCurrent({ current: true });
      const host = hostReading(() => {
        throw columnAhead();
      });

      const response = await host.app.request("/internal/read", { headers });

      expect(response.status).toBe(500);
      expect(logged.errors).not.toEqual([]);
    });
  });
});
