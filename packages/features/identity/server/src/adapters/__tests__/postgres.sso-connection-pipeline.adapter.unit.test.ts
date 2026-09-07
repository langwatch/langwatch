/**
 * The connection write surface the adapter hands back beside the pipeline definition.
 *
 * The operator back office commands connections without running the pipeline, and before
 * this accessor existed the only way to reach `SsoConnectionService` was to rebuild the
 * guards, the break-glass binding and the ledger writer outside this file — a second
 * composition with its own break-glass budget, deciding the same commands differently.
 *
 * @see packages/features/identity/server/src/adapters/postgres.sso-connection-pipeline.adapter.ts
 */
import type { EventSourcing } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

import {
  PostgresSsoConnectionPipelineAdapter,
  type SsoConnectionPipelineDatabase,
} from "../postgres.sso-connection-pipeline.adapter.ts";
import { PlatformOperatorPort } from "../../ports/platform-operator.port.ts";

/** The models the connection graph reads, none of them touched at composition time. */
function testDatabase(): SsoConnectionPipelineDatabase {
  const model = { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn() };
  return {
    ssoConnection: model,
    ssoConnectionStranding: model,
    user: model,
    organization: model,
  } as unknown as SsoConnectionPipelineDatabase;
}

/** A runtime with the stack switched off: nothing here commits. */
function testEventSourcing(): EventSourcing {
  return {
    isEnabled: false,
    getEventStore: vi.fn(),
    getPipeline: vi.fn(),
  } as unknown as EventSourcing;
}

class TestOperators extends PlatformOperatorPort {
  isPlatformOperatorEmail(): boolean {
    return true;
  }
}

function testAdapter(): PostgresSsoConnectionPipelineAdapter {
  return PostgresSsoConnectionPipelineAdapter.create({
    database: testDatabase(),
    eventSourcing: testEventSourcing(),
    operators: new TestOperators(),
  });
}

describe("PostgresSsoConnectionPipelineAdapter", () => {
  describe("when a process asks for the connection write surface", () => {
    /** @scenario "The back office commands through the pipeline's own connection service" */
    it("hands back the same service every time, and the same one after the pipeline is built", () => {
      const adapter = testAdapter();

      const first = adapter.connections();
      expect(adapter.connections()).toBe(first);

      adapter.build();
      expect(adapter.connections()).toBe(first);
    });

    it("hands back that service when the pipeline was built first", () => {
      const adapter = testAdapter();

      adapter.build();
      expect(adapter.connections()).toBe(adapter.connections());
    });

    it("exposes the connection verbs the operator back office commands through", () => {
      const connections = testAdapter().connections();

      expect(connections.registerConnection).toBeTypeOf("function");
      expect(connections.claimDomain).toBeTypeOf("function");
      expect(connections.requestTeardown).toBeTypeOf("function");
    });
  });
});
