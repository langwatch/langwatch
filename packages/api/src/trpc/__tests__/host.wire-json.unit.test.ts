/**
 * What the tRPC door puts on the wire: plain JSON, no transformer.
 * @see packages/api/specs/trpc-framework.feature
 */

import type { PermissionDecision } from "@langwatch/authorization";
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { createApiDouble } from "../../__tests__/api-double.ts";
import type { Authorize } from "../../access/access.ts";
import { SessionReader } from "../../hosting/session-reader.ts";
import type { WireOf } from "../../web/index.ts";
import { composeTrpcRouters } from "../compose.ts";
import { TrpcHost } from "../host.ts";
import { defineTrpcRouter } from "../runtime.ts";

const happenedAt = new Date("2026-10-06T09:30:00.000Z");
const storedRowSchema = z.object({ id: z.string(), createdAt: z.date() });
type StoredRow = z.infer<typeof storedRowSchema>;

interface EventApi {
  occurrence(input: { id: string }): { at: Date };
  storedRow(input: { id: string }): StoredRow;
}

const EventApi = moduleApi<EventApi>()("annotation");

const reads = defineTrpcRouter(
  EventApi,
  defineTrpcContract("events")
    .query("occurrence")
    .withInput(z.object({ projectId: z.string(), id: z.string() }))
    .withOutput(z.object({ at: z.date() }))
    .query("storedRow")
    .withInput(z.object({ projectId: z.string(), id: z.string() }))
    .withOutput(storedRowSchema)
    .build(),
)
  .procedure("occurrence")
  .withPermission("annotations:view")
  .handle(({ app, input }) => app.occurrence(input))
  .procedure("storedRow")
  .withPermission("annotations:view")
  .handle(({ app, input }) => app.storedRow(input))
  .build();

function served() {
  const authz = createApiDouble<Authorize>({
    getDecision: async (): Promise<PermissionDecision> => ({
      permitted: true,
      organizationRole: "MEMBER",
    }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
  });
  const trpc = TrpcHost.create({
    sessions: SessionReader.create({ verify: async () => ({ userId: "sam" }) }),
    authz,
  });
  const application: EventApi = {
    occurrence: () => ({ at: happenedAt }),
    storedRow: ({ id }) => ({ id, createdAt: happenedAt }),
  };
  trpc.mount(composeTrpcRouters("events", [reads]), () => application);

  const call = async (procedure: "occurrence" | "storedRow"): Promise<string> => {
    const request = new Request(
      `http://api.test${TrpcHost.path}/events.${procedure}?input=${encodeURIComponent(
        JSON.stringify({ projectId: "p1", id: "row-1" }),
      )}`,
    );
    const response = await fetchRequestHandler({
      endpoint: TrpcHost.path,
      req: request,
      router: trpc.router,
      createContext: () => trpc.context({ request }),
    });

    return response.text();
  };

  return { trpc, call };
}

describe("given the process built its tRPC root", () => {
  describe("when the root's runtime configuration is read", () => {
    /** @scenario "No transformer is configured on either side" */
    it("registers no data transformer on the server", async () => {
      const { trpc, call } = served();
      const { transformer } = trpc.router._def._config;
      const probe = { at: happenedAt };

      expect(transformer.input.serialize(probe)).toBe(probe);
      expect(transformer.output.serialize(probe)).toBe(probe);
      expect(transformer.output.deserialize(probe)).toBe(probe);

      const body = JSON.parse(await call("occurrence")) as Record<string, unknown>;

      expect(body).toEqual({ result: { data: { at: happenedAt.toISOString() } } });
      expect(body).not.toHaveProperty("result.data.json");
    });
  });
});

describe("given a procedure that answers with an instant", () => {
  describe("when the response is encoded for the wire", () => {
    /** @scenario "An instant crosses the wire as an ISO 8601 string" */
    it("sends the instant as an ISO 8601 string typed as a string", async () => {
      const { call } = served();

      const body = JSON.parse(await call("occurrence")) as { result: { data: { at: unknown } } };

      expect(body.result.data.at).toBe("2026-10-06T09:30:00.000Z");
      expect(typeof body.result.data.at).toBe("string");
      expectTypeOf<WireOf<{ at: Date }>>().toEqualTypeOf<{ at: string }>();
    });
  });
});

describe("given a procedure that answers with a stored row carrying a timestamp column", () => {
  describe("when the client receives the answer", () => {
    /** @scenario "A stored row's timestamp column arrives as a string" */
    it("holds the column as an ISO 8601 string a caller parses at the point of use", async () => {
      const { call } = served();

      const body = JSON.parse(await call("storedRow")) as { result: { data: unknown } };
      const received = body.result.data as { id: string; createdAt: unknown };

      expect(received).toEqual({ id: "row-1", createdAt: "2026-10-06T09:30:00.000Z" });
      expect(typeof received.createdAt).toBe("string");
      expect(new Date(received.createdAt as string).getTime()).toBe(happenedAt.getTime());
      expectTypeOf<WireOf<StoredRow>>().toEqualTypeOf<{ id: string; createdAt: string }>();
    });
  });
});
