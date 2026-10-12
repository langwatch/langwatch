import { describe, expect, it, vi } from "vitest";
import { z } from "zod/mini";

import type { Operation } from "../../api-reference/model/operation.ts";
import { MockDocsTokenProvider } from "../model/mock-token-provider.ts";
import { createDocsSession } from "../model/session-config.ts";
import { DocsSessionController } from "../model/session-controller.ts";
import { docsSessionTokenSchema } from "../model/token-provider.ts";

function traceOperation(): Operation {
  return {
    method: "GET",
    path: "/api/v1/traces/{traceId}",
    origin: "https://app.langwatch.ai",
    summary: "Read trace",
    description: "",
    deprecated: false,
    schemes: [{ id: "apiKey", type: "apiKey", in: "header", name: "X-Auth-Token" }],
    parameters: [
      {
        in: "path",
        name: "traceId",
        required: true,
        deprecated: false,
        description: "",
        schema: { type: "string" },
      },
    ],
    body: null,
    responses: [],
  };
}

const requestState = { values: { "path:traceId": "demo-trace" }, body: "" };

describe("when docs session authentication is configured", () => {
  /** @scenario "Keep session authentication off by default" */
  it("only creates a provider for the explicit mock flag", () => {
    expect(createDocsSession({})).toBeNull();
    expect(createDocsSession({ mode: "off" })).toBeNull();
    expect(createDocsSession({ mode: "mock" })?.snapshot()).toEqual({ kind: "disconnected" });
    expect(() => createDocsSession({ mode: "live" })).toThrow("Invalid option");
  });
});

describe("when the demo session ends", () => {
  /** @scenario "Expire and disconnect a mock session" */
  it("clears access at expiry and disconnect, and allows explicit reconnection", async () => {
    let time = 1_000_000;
    const now = () => time;
    const provider = MockDocsTokenProvider.create({ now });
    const controller = DocsSessionController.create({ provider, now });
    const signal = new AbortController().signal;
    await controller.connect({ signal });
    expect(controller.snapshot()).toEqual({
      kind: "ready",
      projectName: "Docs demo project",
      expiresAt: 1_060_000,
    });
    const response = await controller.send({
      operation: traceOperation(),
      state: requestState,
      signal,
    });
    expect(await response.json()).toMatchObject({
      demo: true,
      project_id: "docs-demo-project",
      trace_id: "demo-trace",
    });
    time += 60_000;
    expect(controller.snapshot()).toEqual({ kind: "expired" });
    await expect(
      controller.send({ operation: traceOperation(), state: requestState, signal }),
    ).rejects.toMatchObject({ code: "expired" });
    await controller.connect({ signal });
    expect(controller.snapshot()).toMatchObject({ kind: "ready", expiresAt: 1_120_000 });
    await controller.disconnect();
    expect(controller.snapshot()).toEqual({ kind: "disconnected" });
    await expect(
      controller.send({ operation: traceOperation(), state: requestState, signal }),
    ).rejects.toMatchObject({ code: "expired" });
  });

  /** @scenario "Ignore a connection completed after cancellation" */
  it("refuses an in-flight acquisition after disconnect", async () => {
    const provider = MockDocsTokenProvider.create();
    const controller = DocsSessionController.create({ provider });
    const acquisition = controller.connect({ signal: new AbortController().signal });
    const disconnected = controller.disconnect();
    await expect(acquisition).rejects.toMatchObject({ code: "cancelled" });
    await disconnected;
    expect(controller.snapshot()).toEqual({ kind: "disconnected" });
  });
});

describe("when a session receives an unsupported request or credential", () => {
  /** @scenario "Refuse credentials outside the approved scope" */
  it("rejects changed origins, methods, endpoints, expired tokens and malformed grants", async () => {
    const now = () => 1_000_000;
    const provider = MockDocsTokenProvider.create({ now });
    const controller = DocsSessionController.create({ provider, now });
    const signal = new AbortController().signal;
    await controller.connect({ signal });
    for (const change of [
      { origin: "https://other.example" },
      { method: "DELETE" },
      { path: "/api/projects" },
    ]) {
      await expect(
        controller.send({
          operation: { ...traceOperation(), ...change },
          state: requestState,
          signal,
        }),
      ).rejects.toMatchObject({ code: "scope" });
    }
    const valid = await provider.acquire({ signal });
    const acquire = vi.spyOn(provider, "acquire");
    for (const change of [
      { expiresAt: now() },
      { expiresAt: now() + 300_001 },
      { expiresAt: NaN },
      { expiresAt: now() + 1_000.5 },
      { permissions: [] },
      { permissions: [""] },
      { grantId: "" },
      { apiOrigin: "not a url" },
      { scope: "all" },
    ]) {
      acquire.mockResolvedValueOnce({ ...valid, ...change });
      await expect(controller.connect({ signal })).rejects.toMatchObject({ code: "invalid" });
      expect(controller.snapshot()).toEqual({ kind: "disconnected" });
    }
    expect(z.validate(docsSessionTokenSchema, { ...valid, purpose: "app" })).toBe(false);
    expect(docsSessionTokenSchema.parse({ ...valid })).toEqual(valid);
  });
});
