/**
 * Spec: specs/ai-gateway/realtime-sessions.feature
 *
 * The reconciler was built and never started, and that is invisible from the
 * outside: every workspace whose post-call webhook arrives is billed correctly
 * either way, and every workspace whose does not is billed nothing at all. So
 * what is asserted here is the START — the installer runs the loop, its first
 * tick reaches the database, and closing it stops the loop.
 */
import { describe, expect, it, vi } from "vitest";
import { GatewayRealtimeSessionWorkerFeatureInstaller } from "../../features/gateway/gateway-realtime-session-worker-feature.installer";
import {
  tryCreateWorkerRealtimeSessionPoller,
  WorkerRealtimeSessionAbsenceReportPort,
} from "../worker-realtime-session.composition";

/** A 32-byte key in the hex spelling the stored-secret cipher demands. */
const CREDENTIALS_KEY = "a".repeat(64);

function databaseDouble() {
  const updateMany = vi.fn(async () => ({ count: 2 }));
  const findMany = vi.fn(async () => []);
  return {
    calls: { updateMany, findMany },
    client: { gatewayRealtimeSession: { updateMany, findMany } },
  };
}

class RecordingAbsence extends WorkerRealtimeSessionAbsenceReportPort {
  readonly reasons: string[] = [];

  withoutPoller(reason: string): void {
    this.reasons.push(reason);
  }
}

const spendConfirmation = { confirmSpend: async () => undefined };

describe("given a worker holding the database and the stored-credential key", () => {
  describe("when its feature installers run", () => {
    /** @scenario "The worker starts the voice reconciler when it boots" */
    it("sweeps stale sessions on the first tick and stops on close", async () => {
      const database = databaseDouble();
      const poller = tryCreateWorkerRealtimeSessionPoller({
        database: database.client as never,
        encryptionKey: CREDENTIALS_KEY,
        spendConfirmation: spendConfirmation as never,
      });
      if (!poller) throw new Error("the composition refused a fully configured process");

      const close = await GatewayRealtimeSessionWorkerFeatureInstaller.create({
        poller,
      }).install();
      // The first tick is fired rather than scheduled, so it is already in
      // flight; awaiting the microtask queue is what lets it reach the double.
      await Promise.resolve();
      await Promise.resolve();
      await close?.();

      expect(database.calls.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "OPEN" }),
        }),
      );
      expect(database.calls.findMany).toHaveBeenCalledTimes(1);
    });
  });
});

describe("given a worker whose deployment named no credentials key", () => {
  describe("when it composes the voice reconciler", () => {
    /** @scenario "A worker without the stored-credential key composes no reconciler" */
    it("composes none and names the missing input", () => {
      const absence = new RecordingAbsence();

      const poller = tryCreateWorkerRealtimeSessionPoller({
        database: databaseDouble().client as never,
        encryptionKey: undefined,
        spendConfirmation: spendConfirmation as never,
        absence,
      });

      expect(poller).toBeUndefined();
      expect(absence.reasons).toEqual(["no-encryption-key"]);
    });
  });
});
