/** @vitest-environment node */

import { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/module";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { authorizationPort, createApiDouble } from "../../__tests__/api-double.ts";
import { createErrorHandler } from "../../errors.ts";
import { defineRestRouter } from "../declaration.ts";
import { bodyLimit } from "../request.ts";
import { createRestRuntime } from "../runtime.ts";

/** A body whose upload breaks off after its first chunk, as a client that went away. */
function brokenUpload(): RequestInit {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"partial":'));
      controller.error(Object.assign(new Error("aborted"), { code: "ECONNRESET" }));
    },
  });
  return { method: "POST", body, duplex: "half" } as RequestInit;
}

interface NoteApi {
  record(input: { raw: string }): Promise<{ raw: string }>;
}

const NoteApi = moduleApi<NoteApi>()("annotation");

const notes = defineRestRouter(NoteApi)
  .withNamespace("notes")
  .withVersion("2026-09-08")
  .withAddressing("v1-only")
  .withCredential("organization")
  .post("/", "recordNote")
  .keepsRecords()
  .withRawBody("text")
  .withPermission("organization:manage")
  .withOutput(z.object({ raw: z.string() }))
  .withoutAudit("test route")
  .handle(async ({ app, raw }) => app.record({ raw }))
  .build();

describe("a request body that stops arriving", () => {
  describe("when a raw-body route reads it", () => {
    /** @scenario "A request whose body stopped arriving is the sender's 400, not a 500" */
    it("answers 400 request_body_unreadable", async () => {
      const record = vi.fn(async ({ raw }: { raw: string }) => ({ raw }));
      const runtime = createRestRuntime({
        authorization: authorizationPort,
        identity: {
          authenticate: () => ({
            actor: { type: "api_key", id: "key-1" },
            scope: { tier: "organization", id: "organization-1" },
          }),
          authorize: () => ({ permitted: true, organizationRole: null }),
        },
      });
      const hono = runtime.mount(notes.router(), {
        app: () => createApiDouble<NoteApi>({ record }),
        onError: createErrorHandler(),
      });

      const response = await hono.request("/api/v1/notes", {
        ...brokenUpload(),
        headers: { Authorization: "Bearer key", "X-LangWatch-API-Version": "2026-09-08" },
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: "request_body_unreadable" });
      expect(record).not.toHaveBeenCalled();
    });
  });

  describe("when the ingestion size cap measures it", () => {
    it("refuses it as the customer's request_body_unreadable", async () => {
      let failure: unknown;
      const app = new Hono();
      app.onError((error, c) => {
        failure = error;
        return c.text("refused", 400);
      });
      app.use(bodyLimit({ maxSize: 1_000 }));
      app.post("/ingest", (c) => c.text("ok"));

      await app.request("/ingest", brokenUpload());

      expect(HandledError.isHandled(failure)).toBe(true);
      expect(failure).toMatchObject({
        code: "request_body_unreadable",
        httpStatus: 400,
        fault: "customer",
      });
    });
  });
});
