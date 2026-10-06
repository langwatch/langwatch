/**
 * The tRPC record the api mounts, asked over HTTP on the api booted wholly live over Postgres,
 * Redis and ClickHouse (§7).
 * @vitest-environment node
 * @see specs/server/api-process-trpc-record.feature
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { processModules } from "../process-modules.generated.ts";
import { bootLiveApi, liveStoresConfigured, type LiveApi } from "./api-live.fixture.ts";

type DeclaredProcedure = { path: string; kind: "query" | "mutation" };

/** Every query and mutation the installed modules declare, as `namespace.name`. */
function declaredProcedures(): DeclaredProcedure[] {
  const declared: DeclaredProcedure[] = [];
  for (const module of processModules) {
    for (const transport of module.transports ?? []) {
      if (transport.protocol !== "trpc" || !("contract" in transport)) continue;
      const { contract } = transport;
      if (typeof contract !== "object" || contract === null || !("members" in contract)) continue;
      const members = contract.members as Record<string, { kind: string }>;
      for (const [name, member] of Object.entries(members)) {
        if (member.kind === "query" || member.kind === "mutation") {
          declared.push({ path: `${transport.namespace}.${name}`, kind: member.kind });
        }
      }
    }
  }
  return declared;
}

/** Asks one procedure with no credential; the root answers whatever the procedure itself says. */
async function ask(api: LiveApi, { path, kind }: DeclaredProcedure): Promise<string> {
  const response =
    kind === "query"
      ? await api.fetch(`/api/trpc/${path}`)
      : await api.fetch(`/api/trpc/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
  return `${response.status} ${await response.text()}`;
}

const NO_SUCH_PROCEDURE = /No procedure found/i;

describe.skipIf(!liveStoresConfigured)("the api's tRPC record", () => {
  let api: LiveApi;

  beforeAll(async () => {
    api = await bootLiveApi();
  }, 120_000);

  afterAll(async () => {
    await api?.close();
  });

  describe("given every installed module composed the slice it owns", () => {
    /** @scenario "A complete collaborator set mounts the whole record" */
    it("answers every declared namespace on the root, with no procedure absent", async () => {
      const declared = declaredProcedures();
      expect(declared.length).toBeGreaterThan(50);
      expect(new Set(declared.map(({ path }) => path.split(".")[0])).size).toBeGreaterThan(10);

      const control = await ask(api, { path: "noSuchNamespace.noSuchProcedure", kind: "query" });
      expect(control).toMatch(NO_SUCH_PROCEDURE);

      const absent: string[] = [];
      for (const procedure of declared) {
        if (NO_SUCH_PROCEDURE.test(await ask(api, procedure))) absent.push(procedure.path);
      }

      expect(absent).toEqual([]);
    }, 120_000);
  });
});
