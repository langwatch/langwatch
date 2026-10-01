/**
 * The focused tab's hint stream, relayed from the tenant fan-out.
 * Spec: packages/api/specs/read-hints.feature.
 */
import { EventEmitter } from "node:events";

import { createApiFixture } from "@langwatch/api-fixture";
import type { ReadHint } from "@langwatch/notification-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import { describe, expect, it } from "vitest";

import { ReadHintStreamService } from "../read-hint-stream.service.ts";

function fanOut() {
  const emitters = new Map<string, EventEmitter>();
  const released: string[] = [];
  const emitterFor = (tenantId: string) => {
    const emitter = emitters.get(tenantId) ?? new EventEmitter();
    emitters.set(tenantId, emitter);
    return emitter;
  };
  const presence = createApiFixture<PresenceApi>({
    getTenantEmitter: emitterFor,
    cleanupTenantEmitter: (tenantId) => void released.push(tenantId),
  });
  const send = ({ tenantId, frame }: { tenantId: string; frame: unknown }) =>
    emitterFor(tenantId).emit("read_invalidated", frame);
  const hint = (path: string) => ({ event: JSON.stringify({ path }), timestamp: 1 });
  return { presence, send, hint, released };
}

/** Reads what the stream yields until it has `count` hints, then aborts it. */
async function collect({
  stream,
  controller,
  count,
}: {
  stream: AsyncGenerator<ReadHint>;
  controller: AbortController;
  count: number;
}): Promise<ReadHint[]> {
  const hints: ReadHint[] = [];
  for await (const hint of stream) {
    hints.push(hint);
    if (hints.length === count) controller.abort();
  }
  return hints;
}

describe("ReadHintStreamService", () => {
  /** @scenario "A connection is sent the hints for its user, organization and project" */
  it("yields the hints of the user, organization and project it listens on", async () => {
    const { presence, send, hint, released } = fanOut();
    const controller = new AbortController();
    const stream = ReadHintStreamService.create({ emitters: presence }).watch({
      tenantIds: ["u1", "acme", "p1"],
      signal: controller.signal,
    });
    const hints = collect({ stream, controller, count: 3 });
    await Promise.resolve();

    send({ tenantId: "u1", frame: hint("user.getSettings") });
    send({ tenantId: "acme", frame: hint("organization.getScopeGraph") });
    send({ tenantId: "p1", frame: hint("project.getAll") });

    await expect(hints).resolves.toEqual([
      { path: "user.getSettings" },
      { path: "organization.getScopeGraph" },
      { path: "project.getAll" },
    ]);
    expect(released.toSorted()).toEqual(["acme", "p1", "u1"]);
  });

  /** @scenario "A connection is not sent a hint for another tenant" */
  /** @scenario "A malformed broadcast frame is ignored" */
  it("skips other tenants and frames that are not hints, and stays open", async () => {
    const { presence, send, hint } = fanOut();
    const controller = new AbortController();
    const stream = ReadHintStreamService.create({ emitters: presence }).watch({
      tenantIds: ["u1", "acme"],
      signal: controller.signal,
    });
    const hints = collect({ stream, controller, count: 1 });
    await Promise.resolve();

    send({ tenantId: "globex", frame: hint("organization.getScopeGraph") });
    send({ tenantId: "acme", frame: { event: "not json", timestamp: 1 } });
    send({ tenantId: "acme", frame: { event: JSON.stringify({ tenant: "acme" }), timestamp: 1 } });
    send({ tenantId: "acme", frame: "organization.getScopeGraph" });
    send({ tenantId: "acme", frame: hint("organization.getScopeGraph") });

    await expect(hints).resolves.toEqual([{ path: "organization.getScopeGraph" }]);
  });
});
