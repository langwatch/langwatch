import { Readable } from "node:stream";
import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import type { StoredObjectStorageDestination } from "@langwatch/stored-object-contract";
import type {
  StoredObjectStorageProject,
  StoredObjectStorageRuntime,
} from "@langwatch/stored-object-server/storage";
import type { TraceClickHouseClient } from "@langwatch/trace-server";
import { describe, expect, it, vi } from "vitest";
import {
  createWorkerTracePayloadReader,
  createWorkerTraceSpool,
} from "../worker-trace-blob.composition";

/**
 * Spec: packages/features/trace/specs/trace-payload-claim-check.feature
 *
 * A COMPOSITION-CAPABILITY test. Trace has not converted, so nothing in this
 * process reads a spool object or recalls an offloaded field. What has to be
 * true today is that this composition root can build both halves of the ADR-022
 * claim check out of the stored-objects runtime, the AWS client runtime and the
 * tenant-keyed ClickHouse client it already holds.
 *
 * Both are driven through the ports the conversion will actually call —
 * `TraceSpanSpoolPort` and `TracePayloadReaderPort` — rather than through the
 * service and repository underneath them: a graph that resolves correctly but
 * cannot be handed to `RecordSpanCommand` would pass a service-level test and
 * still be unusable here.
 */

const AWS = {} as AwsClientProcessRuntime;

function storageRuntime(options: { destination: StoredObjectStorageDestination; body?: Buffer }): {
  runtime: StoredObjectStorageRuntime;
  gets: string[];
  deletes: string[];
  projects: string[];
} {
  const gets: string[] = [];
  const deletes: string[] = [];
  const projects: string[] = [];
  const project: StoredObjectStorageProject = {
    objectStore: {
      async put(): Promise<void> {},
      async get(uri: string): Promise<Readable> {
        gets.push(uri);
        return Readable.from([options.body ?? Buffer.from("the whole span")]);
      },
      async delete(uri: string): Promise<void> {
        deletes.push(uri);
      },
    },
    resolveDestination: async () => options.destination,
  };
  return {
    runtime: {
      forProject(projectId: string) {
        projects.push(projectId);
        return project;
      },
    } as unknown as StoredObjectStorageRuntime,
    gets,
    deletes,
    projects,
  };
}

describe("createWorkerTraceSpool", () => {
  describe("given a spooled command", () => {
    describe("when the spool is read through the port", () => {
      /** @scenario "The spool object path is derived from the command, never read from it" */
      it("resolves the object from the command's own ids, not its reference", async () => {
        const storage = storageRuntime({ destination: { kind: "s3", bucket: "objects" } });

        const body = await createWorkerTraceSpool({
          runtime: storage.runtime,
          aws: AWS,
          azureRetentionConfirmed: false,
        }).read({
          spoolRef: "spool:v2",
          projectId: "project-1",
          traceId: "trace-1",
          spanId: "span-1",
        });

        expect(body).toBe("the whole span");
        expect(storage.gets).toEqual(["s3://objects/trace-blobs/spool/project-1/trace-1/span-1"]);
        expect(storage.projects).toContain("project-1");
      });
    });

    describe("when the spool is deleted through the port", () => {
      it("deletes the same object the read resolved", async () => {
        const storage = storageRuntime({ destination: { kind: "s3", bucket: "objects" } });

        await createWorkerTraceSpool({
          runtime: storage.runtime,
          aws: AWS,
          azureRetentionConfirmed: false,
        }).delete({
          spoolRef: "spool:v2",
          projectId: "project-1",
          traceId: "trace-1",
          spanId: "span-1",
        });

        expect(storage.deletes).toEqual([
          "s3://objects/trace-blobs/spool/project-1/trace-1/span-1",
        ]);
      });
    });
  });

  describe("given a command carrying a v1 spool key", () => {
    describe("when the project's destination is S3", () => {
      it("reads the key against the project's own bucket", async () => {
        const storage = storageRuntime({ destination: { kind: "s3", bucket: "objects" } });

        await createWorkerTraceSpool({
          runtime: storage.runtime,
          aws: AWS,
          azureRetentionConfirmed: false,
        }).read({
          spoolRef: "trace-blobs/spool/project-1/trace-1/span-1",
          projectId: "project-1",
          traceId: "trace-1",
          spanId: "span-1",
        });

        expect(storage.gets).toEqual(["s3://objects/trace-blobs/spool/project-1/trace-1/span-1"]);
      });
    });

    describe("when the project's destination is not S3", () => {
      /** @scenario "A legacy reference is pinned to the command's own tenant" */
      it("refuses by name rather than minting a location nothing wrote", async () => {
        const storage = storageRuntime({
          destination: { kind: "azure", accountName: "acct", container: "spool" },
        });

        await expect(
          createWorkerTraceSpool({
            runtime: storage.runtime,
            aws: AWS,
            azureRetentionConfirmed: true,
          }).read({
            spoolRef: "trace-blobs/spool/project-1/trace-1/span-1",
            projectId: "project-1",
            traceId: "trace-1",
            spanId: "span-1",
          }),
        ).rejects.toThrow(/v1 spool reference names an S3 object/);
        expect(storage.gets).toEqual([]);
      });
    });
  });
});

describe("createWorkerTracePayloadReader", () => {
  const client = (rows: unknown[]): TraceClickHouseClient =>
    ({
      query: vi.fn(async () => ({ json: async () => rows })),
    }) as unknown as TraceClickHouseClient;

  describe("given an offloaded field recorded against a trace", () => {
    describe("when it is recalled through the port", () => {
      /** @scenario "The event log read names the tenant first" */
      it("recalls it and asks for the trace aggregate", async () => {
        const resolved = client([
          {
            EventPayload: JSON.stringify({
              span: {
                attributes: [{ key: "langwatch.input", value: { stringValue: "recalled" } }],
              },
            }),
          },
        ]);

        const value = await createWorkerTracePayloadReader({
          resolveClickHouseClient: async () => resolved,
        }).tryRead({
          tenantId: "project-1",
          traceId: "trace-1",
          eventId: "evt_0001",
          field: "langwatch.input",
        });

        expect(value).toBe("recalled");
        expect(vi.mocked(resolved.query).mock.calls[0]![0].query_params).toMatchObject({
          tenantId: "project-1",
          aggregateType: "trace",
          aggregateId: "trace-1",
        });
      });
    });
  });

  describe("given the row cannot be read", () => {
    describe("when it is recalled through the port", () => {
      /** @scenario "Absence answers null rather than raising at the read port" */
      it("answers nothing rather than raising into the read path", async () => {
        const value = await createWorkerTracePayloadReader({
          resolveClickHouseClient: async () => {
            throw new Error("clickhouse unreachable");
          },
        }).tryRead({
          tenantId: "project-1",
          traceId: "trace-1",
          eventId: "evt_0001",
          field: "langwatch.input",
        });

        expect(value).toBeNull();
      });
    });
  });
});
