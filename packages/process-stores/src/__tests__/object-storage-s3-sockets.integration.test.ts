/**
 * The S3 client against a local HTTP stand-in: every reader that stops early
 * gives its connection back, and a request that gets no answer fails.
 * @see specs/object-storage-member.feature
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { Readable } from "node:stream";

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Temporal } from "@langwatch/time";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ObjectStorage } from "../members.ts";
import { buildObjectStorage } from "../object-storage-member.ts";
import { s3Backend, s3Client } from "../object-storage-s3.ts";

const clock = { now: () => Temporal.Instant.from("2026-11-13T12:00:00Z") };
const at = { projectId: "project-1", key: "project-1/object-1" };
const credentials = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" };
/** The SDK's default pool: one more early stop than this used to hang every later call. */
const POOL_SIZE = 50;

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

interface FakeS3 {
  readonly endpoint: string;
  readonly methods: string[];
  openSockets(): number;
  close(): Promise<void>;
}

const servers: FakeS3[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function fakeS3(handle: Handler): Promise<FakeS3> {
  const sockets = new Set<Socket>();
  const methods: string[] = [];
  const server = createServer((request, response) => {
    methods.push(request.method ?? "");
    handle(request, response);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const fake: FakeS3 = {
    endpoint: `http://127.0.0.1:${port}`,
    methods,
    openSockets: () => sockets.size,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
  servers.push(fake);
  return fake;
}

/** A GET whose body starts and never ends, as a large object read only in part looks. */
const endlessBody: Handler = (request, response) => {
  if (request.method === "HEAD") {
    response.writeHead(200, { "content-length": "1048576" }).end();
    return;
  }
  response.writeHead(200, { "content-length": "1048576", "content-type": "text/plain" });
  response.write(Buffer.alloc(16 * 1024, 97));
};

function storageOn(endpoint: string): ObjectStorage {
  return buildObjectStorage({
    config: { backend: "s3", s3: { bucket: "objects", endpoint, credentials } },
    directory: { organizationForTenant: () => Promise.resolve(null) },
    clock,
  }).value;
}

interface ConfigurableHandler {
  updateHttpClientConfig(key: "requestTimeout" | "socketTimeout", value: number): void;
}

function isConfigurable(handler: object): handler is ConfigurableHandler {
  return (
    "updateHttpClientConfig" in handler && typeof handler.updateHttpClientConfig === "function"
  );
}

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${what} still waiting after ${ms} ms`)), ms),
    ),
  ]);
}

describe("given object storage on S3", () => {
  describe("when more readers than the pool holds stop before reading a byte", () => {
    /** @scenario "A body a reader stops early gives its connection back" */
    it("closes each connection, and the next read still answers", async () => {
      const s3 = await fakeS3(endlessBody);
      const storage = storageOn(s3.endpoint);

      for (let read = 1; read <= POOL_SIZE + 10; read++) {
        const body = await within(storage.read(at), 2_000, `read #${read}`);
        await body[Symbol.asyncIterator]().return?.();
      }

      await vi.waitFor(() => expect(s3.openSockets()).toBe(0), { timeout: 2_000 });
    });
  });

  describe("when a reader wraps the body in a stream and destroys it unread", () => {
    /** @scenario "A body a reader stops early gives its connection back" */
    it("closes the connection", async () => {
      const s3 = await fakeS3(endlessBody);
      const storage = storageOn(s3.endpoint);

      Readable.from(await storage.read(at)).destroy();

      await vi.waitFor(() => expect(s3.openSockets()).toBe(0), { timeout: 2_000 });
    });
  });

  describe("when a module asks whether an object exists", () => {
    /** @scenario "An existence check asks for the object's headers and opens no body" */
    it("sends a HEAD, never a GET, and answers true", async () => {
      const s3 = await fakeS3(endlessBody);

      await expect(storageOn(s3.endpoint).exists(at)).resolves.toBe(true);
      expect(s3.methods).toEqual(["HEAD"]);
    });

    it("answers false for an object S3 does not hold", async () => {
      const s3 = await fakeS3((_request, response) => response.writeHead(404).end());

      await expect(storageOn(s3.endpoint).exists(at)).resolves.toBe(false);
    });
  });
});

describe("given an S3 client with a short request timeout", () => {
  function shortTimeoutClient(endpoint: string) {
    const client = s3Client({ bucket: "objects", endpoint, credentials });
    const handler: object = client.config.requestHandler;
    if (!isConfigurable(handler)) throw new Error("The S3 client holds no configurable handler.");
    handler.updateHttpClientConfig("requestTimeout", 300);
    return client;
  }

  describe("when S3 accepts a request and never answers it", () => {
    /** @scenario "An S3 request that gets no answer fails within the request timeout" */
    it("fails with a timeout instead of holding the connection", async () => {
      const s3 = await fakeS3(() => undefined);
      const client = shortTimeoutClient(s3.endpoint);

      await expect(
        within(
          client.send(new GetObjectCommand({ Bucket: "objects", Key: at.key })),
          3_000,
          "the unanswered GET",
        ),
      ).rejects.toMatchObject({ name: "TimeoutError" });
    });
  });

  describe("when a download's body takes longer than the timeout to arrive", () => {
    /** @scenario "An S3 request that gets no answer fails within the request timeout" */
    it("reads the whole body: the timeout ends at the answer's headers", async () => {
      const s3 = await fakeS3((_request, response) => {
        response.writeHead(200, { "content-length": "4" });
        let sent = 0;
        const drip = setInterval(() => {
          response.write("a");
          if (++sent === 4) {
            clearInterval(drip);
            response.end();
          }
        }, 200);
      });
      const backend = s3Backend({
        client: shortTimeoutClient(s3.endpoint),
        bucket: "objects",
        clock,
      });

      let text = "";
      for await (const chunk of await backend.read(at)) text += Buffer.from(chunk).toString();

      expect(text).toBe("aaaa");
    });
  });

  describe("when an upload takes longer than the timeout to be acknowledged", () => {
    /** @scenario "An S3 request that gets no answer fails within the request timeout" */
    it("completes the write: a write is bounded by inactivity, not by its length", async () => {
      const s3 = await fakeS3((request, response) => {
        request.resume();
        request.on("end", () => setTimeout(() => response.writeHead(200).end(), 800));
      });
      const backend = s3Backend({
        client: shortTimeoutClient(s3.endpoint),
        bucket: "objects",
        clock,
      });

      await expect(
        backend.write(at, Readable.from([Buffer.from("hello")]), {
          byteLength: 5,
          contentType: "text/plain",
        }),
      ).resolves.toMatchObject({ byteLength: 5 });
    });
  });
});

describe("given an S3 client with a short socket idle limit", () => {
  describe("when S3 stops taking an upload's bytes and never answers", () => {
    /** @scenario "An upload that stops moving is cut after the idle limit" */
    it("fails the write with a timeout and closes the connection", async () => {
      const stalled: IncomingMessage[] = [];
      const s3 = await fakeS3((request) => stalled.push(request.pause()));
      const client = s3Client({ bucket: "objects", endpoint: s3.endpoint, credentials });
      const handler: object = client.config.requestHandler;
      if (!isConfigurable(handler)) throw new Error("The S3 client holds no configurable handler.");
      handler.updateHttpClientConfig("socketTimeout", 300);
      const backend = s3Backend({ client, bucket: "objects", clock });
      const size = 32 * 1024 * 1024;

      const write = backend.write(at, Readable.from([Buffer.alloc(size, 97)]), {
        byteLength: size,
        contentType: "application/octet-stream",
      });

      await expect(within(write, 5_000, "the stalled upload")).rejects.toMatchObject({
        name: "TimeoutError",
      });
      // A peer that reads nothing never sees the close, so read on: a live client keeps sending.
      for (const request of stalled) request.resume();
      await vi.waitFor(() => expect(s3.openSockets()).toBe(0), { timeout: 2_000 });
    });
  });
});

describe("given an S3 backend with a short body idle limit", () => {
  describe("when a body's headers arrive at once and then its bytes stop", () => {
    /** @scenario "A body that stops arriving is cut after the idle limit" */
    it("ends the read with a timeout and closes the connection", async () => {
      const s3 = await fakeS3(endlessBody);
      const client = s3Client({ bucket: "objects", endpoint: s3.endpoint, credentials });
      const backend = s3Backend({ client, bucket: "objects", clock, bodyIdleMs: 300 });

      const body = await backend.read(at);
      const drained = (async () => {
        for await (const chunk of body) void chunk;
      })();

      await expect(within(drained, 3_000, "the stalled body")).rejects.toMatchObject({
        name: "TimeoutError",
      });
      await vi.waitFor(() => expect(s3.openSockets()).toBe(0), { timeout: 2_000 });
    });
  });
});
