/**
 * Spec: specs/server/api-process-authz.feature
 */
import type { GroupQueueDependencies } from "@langwatch/group-queue";
import { PrismaConnection } from "@langwatch/prisma-client";
import { ResourceScope } from "@langwatch/runtime-composition";
import { EventingAuthzCommandDispatcherAdapter } from "@langwatch/authz-server";
import { Registry } from "prom-client";
import { describe, expect, it, vi } from "vitest";
import { ApiAuthzAbsenceReportPort, ApiAuthzComposition } from "../api-authz.composition";
import { ApiEventingInfrastructure } from "../../platform/infrastructure/api-eventing.infrastructure";

const AUTHZ_GRANT_PIPELINE = "authz_grant";

/**
 * A connection whose delegates exist and whose statements refuse.
 *
 * Composing AuthZ reads delegates off the client but runs nothing — every
 * repository below the adapter is lazy — so the refusal is an assertion in its
 * own right: this file is about what the composition WIRES, and a composition
 * that queried at boot would fail here rather than pass quietly.
 */
function stubConnection(): PrismaConnection {
  const refusingStatement = () => {
    throw new Error("Composing AuthZ must not query the database.");
  };
  const delegate = new Proxy({}, { get: () => refusingStatement });
  const client = new Proxy({}, { get: () => delegate });
  return PrismaConnection.create({ client: client as never, pool: client as never });
}

/**
 * Group Queue dependencies over a Redis that answers every command with
 * nothing. Composing a producer registers the queue's staging set; it enqueues
 * no job, and this file sends none.
 */
function stubQueue(): { dependencies: GroupQueueDependencies<Record<string, unknown>> } {
  const redis = new Proxy({}, { get: () => async () => 0 });
  return { dependencies: { redis: redis as never } };
}

function eventing(resources: ResourceScope): ApiEventingInfrastructure {
  return ApiEventingInfrastructure.create({
    resources,
    queue: stubQueue(),
    processName: "langwatch-api-test",
  });
}

class RecordingAbsence extends ApiAuthzAbsenceReportPort {
  readonly reasons: string[] = [];

  absent(reason: "no-database" | "no-eventing"): void {
    this.reasons.push(reason);
  }
}

const config = {
  epochCacheEnabled: false,
  demoProjectId: undefined,
  demoProjectUserId: undefined,
} as const;

describe("ApiAuthzComposition", () => {
  describe("when the process has a database and its own dispatch", () => {
    /** @scenario "The API process composes its own AuthZ service" */
    it("composes both AuthZ contract services out of its own infrastructure", () => {
      const resources = new ResourceScope();

      const composed = ApiAuthzComposition.compose({
        database: stubConnection(),
        eventing: eventing(resources),
        epoch: null,
        config,
        registry: new Registry(),
      });

      expect(composed.permissions).toBeDefined();
      expect(composed.grants).toBeDefined();
    });

    // Composition itself is the assertion that the ledger's write path opened:
    // a registration that produced no real senders makes `sendersFrom`
    // throw, so a `compose` that returns at all has connected six of them.
    /** @scenario "The API process registers the packaged grants pipeline, not a copy" */
    it("registers the packaged grants pipeline on its own producer-only runtime", () => {
      const resources = new ResourceScope();
      const runtime = eventing(resources);

      ApiAuthzComposition.compose({
        database: stubConnection(),
        eventing: runtime,
        epoch: null,
        config,
        registry: new Registry(),
      });

      const registered = runtime.eventSourcing.getPipeline(AUTHZ_GRANT_PIPELINE);
      expect(registered.constructor.name).not.toBe("DisabledPipeline");
      expect(() =>
        EventingAuthzCommandDispatcherAdapter.sendersFrom(
          (registered as { commands: Record<string, unknown> }).commands,
        ),
      ).not.toThrow();
    });

    // The dispatcher is half of what the closed `API_UNAVAILABLE_PRODUCT_ADAPTERS`
    // entry named, and its whole job is the connection: an unconnected one is a
    // ledger that waits five seconds and then refuses every grant change. The
    // registration succeeding is not the same fact, so this asserts the wiring
    // itself rather than inferring it.
    /** @scenario "The API process registers the packaged grants pipeline, not a copy" */
    it("opens the ledger's write path with the senders that registration produced", async () => {
      const resources = new ResourceScope();
      const connect = vi.spyOn(EventingAuthzCommandDispatcherAdapter.prototype, "connect");

      const composed = ApiAuthzComposition.compose({
        database: stubConnection(),
        eventing: eventing(resources),
        epoch: null,
        config,
        registry: new Registry(),
      });

      expect(composed).toBeDefined();
      expect(connect).toHaveBeenCalledTimes(1);
      expect(Object.keys(connect.mock.calls[0]![0])).toEqual([
        "attachGrant",
        "changeGrantRole",
        "revokeGrant",
        "defineRole",
        "changeRolePermissions",
        "deleteRole",
      ]);
      connect.mockRestore();
    });

    /** @scenario "The API process registers the packaged grants pipeline, not a copy" */
    it("registers it exactly once, so one aggregate has one producer in this process", () => {
      const resources = new ResourceScope();
      const runtime = eventing(resources);
      const registerSpy = vi.spyOn(runtime.eventSourcing, "register");

      ApiAuthzComposition.compose({
        database: stubConnection(),
        eventing: runtime,
        epoch: null,
        config,
        registry: new Registry(),
      });

      expect(registerSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the process is missing half of the write path", () => {
    /** @scenario "A process with no database composes no AuthZ service" */
    it("composes nothing without a database and names which half is missing", () => {
      const report = new RecordingAbsence();
      const resources = new ResourceScope();

      const composed = ApiAuthzComposition.tryCompose({
        database: undefined,
        eventing: eventing(resources),
        epoch: null,
        config,
        registry: new Registry(),
        report,
      });

      expect(composed).toBeUndefined();
      expect(report.reasons).toEqual(["no-database"]);
    });

    /** @scenario "A process with no dispatch composes no AuthZ service" */
    it("composes nothing without dispatch and names which half is missing", () => {
      const report = new RecordingAbsence();

      const composed = ApiAuthzComposition.tryCompose({
        database: stubConnection(),
        eventing: undefined,
        epoch: null,
        config,
        registry: new Registry(),
        report,
      });

      expect(composed).toBeUndefined();
      expect(report.reasons).toEqual(["no-eventing"]);
    });
  });
});
