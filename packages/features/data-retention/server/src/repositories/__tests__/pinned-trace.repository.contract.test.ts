/**
 * @vitest-environment node
 * The pinned-trace contract, stated once and run against every backend the
 * package can reach. The memory twin runs always; a Postgres backend joins the
 * table when this package declares a datastore in its vitest config.
 * @see specs/data-retention-service.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryPinnedTraceRepository } from "../memory/memory.pinned-trace.repository.ts";
import type { PinnedTraceRepository } from "../pinned-trace.repository.ts";

const backends: ReadonlyArray<{ name: string; create: () => PinnedTraceRepository }> = [
  { name: "memory", create: () => MemoryPinnedTraceRepository.create() },
];

const PROJECT = "project_1";
const OTHER_PROJECT = "project_2";
const TRACE = "trace_1";

describe.each(backends)("given the $name pinned trace repository", ({ create }) => {
  describe("when the trace is not pinned", () => {
    /** @scenario "The memory and Postgres data retention repositories answer alike" */
    it("answers absence with null rather than a refusal", async () => {
      const repository = create();

      await expect(
        repository.findByProjectAndTrace({ projectId: PROJECT, traceId: TRACE }),
      ).resolves.toBeNull();
    });

    it("answers no pins and no trace ids for the project", async () => {
      const repository = create();

      await expect(repository.findAllByProject({ projectId: PROJECT })).resolves.toEqual([]);
      await expect(repository.findAllTraceIds({ projectId: PROJECT })).resolves.toEqual([]);
    });

    it("reports no manual pin", async () => {
      const repository = create();

      await expect(
        repository.hasManualPin({ projectId: PROJECT, traceId: TRACE }),
      ).resolves.toBe(false);
    });

    it("deletes a pin nobody wrote without complaint", async () => {
      const repository = create();

      await expect(
        repository.delete({ projectId: PROJECT, traceId: TRACE }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a person pins the trace", () => {
    it("reads the pin back with the reason they typed", async () => {
      const repository = create();

      const pin = await repository.create({
        projectId: PROJECT,
        traceId: TRACE,
        userId: "user_olive",
        reason: "the customer asked us to keep it",
        source: "manual",
      });

      expect(pin).toMatchObject({
        projectId: PROJECT,
        traceId: TRACE,
        userId: "user_olive",
        source: "manual",
        reason: "the customer asked us to keep it",
      });
      await expect(
        repository.findByProjectAndTrace({ projectId: PROJECT, traceId: TRACE }),
      ).resolves.toEqual(pin);
      await expect(repository.findAllTraceIds({ projectId: PROJECT })).resolves.toEqual([TRACE]);
      await expect(repository.hasManualPin({ projectId: PROJECT, traceId: TRACE })).resolves.toBe(
        true,
      );
    });

    it("removes the pin when it is deleted", async () => {
      const repository = create();

      await repository.create({ projectId: PROJECT, traceId: TRACE, source: "manual" });
      await repository.delete({ projectId: PROJECT, traceId: TRACE });

      await expect(
        repository.findByProjectAndTrace({ projectId: PROJECT, traceId: TRACE }),
      ).resolves.toBeNull();
    });
  });

  describe("when a share pins a trace a person already pinned", () => {
    it("leaves the reason the person typed alone", async () => {
      const repository = create();

      const manual = await repository.create({
        projectId: PROJECT,
        traceId: TRACE,
        userId: "user_olive",
        reason: "the customer asked us to keep it",
        source: "manual",
      });
      const automatic = await repository.create({
        projectId: PROJECT,
        traceId: TRACE,
        source: "share",
      });

      expect(automatic).toEqual(manual);
      await expect(repository.hasManualPin({ projectId: PROJECT, traceId: TRACE })).resolves.toBe(
        true,
      );
    });

    it("records the share's own pin when nobody pinned it by hand", async () => {
      const repository = create();

      const pin = await repository.create({ projectId: PROJECT, traceId: TRACE, source: "share" });

      expect(pin).toMatchObject({ source: "share", userId: null, reason: null });
      await expect(repository.hasManualPin({ projectId: PROJECT, traceId: TRACE })).resolves.toBe(
        false,
      );
    });

    it("lets a later manual pin take the row over", async () => {
      const repository = create();

      await repository.create({ projectId: PROJECT, traceId: TRACE, source: "share" });
      await repository.create({
        projectId: PROJECT,
        traceId: TRACE,
        userId: "user_olive",
        reason: "keep",
        source: "manual",
      });

      await expect(
        repository.findByProjectAndTrace({ projectId: PROJECT, traceId: TRACE }),
      ).resolves.toMatchObject({ source: "manual", userId: "user_olive", reason: "keep" });
    });
  });

  describe("when another project pinned a trace of the same id", () => {
    it("never answers with the other project's pin", async () => {
      const repository = create();

      await repository.create({ projectId: OTHER_PROJECT, traceId: TRACE, source: "manual" });

      await expect(
        repository.findByProjectAndTrace({ projectId: PROJECT, traceId: TRACE }),
      ).resolves.toBeNull();
      await expect(repository.findAllByProject({ projectId: PROJECT })).resolves.toEqual([]);
      await expect(repository.findAllTraceIds({ projectId: PROJECT })).resolves.toEqual([]);
      await expect(repository.hasManualPin({ projectId: PROJECT, traceId: TRACE })).resolves.toBe(
        false,
      );
    });

    it("never deletes the other project's pin", async () => {
      const repository = create();

      await repository.create({ projectId: OTHER_PROJECT, traceId: TRACE, source: "manual" });
      await repository.delete({ projectId: PROJECT, traceId: TRACE });

      await expect(
        repository.findAllByProject({ projectId: OTHER_PROJECT }),
      ).resolves.toHaveLength(1);
    });
  });
});
