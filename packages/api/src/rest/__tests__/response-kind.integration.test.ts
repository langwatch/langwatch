/**
 * What a route that declared a response kind answers with, written by the
 * framework. Spec: packages/api/specs/declared-response-kinds.feature.
 */

import { moduleApi } from "@langwatch/kernel";
import { Hono } from "hono";
import { generateSpecs } from "hono-openapi";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { publicRoute } from "../../access/access.ts";
import { createErrorHandler } from "../../errors.ts";
import { defineRestRouter } from "../declaration.ts";
import { producerFor, type RestEvent } from "../response-kind.ts";
import { createRestRuntime } from "../runtime.ts";

const VERSION = "2026-09-08";
const SCIM_REASON = "SCIM's own envelope is RFC 7644's, not ours";
const PROXY_REASON = "the upstream engine terminates the request itself";
const DISPOSITION = 'inline; filename="avatar-object-1.png"';
const FRAMED = "event: tick\ndata: one\n\nid: 2\ndata: two\ndata: lines\n\n";
const SCIM_ANSWER = '{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"sent":18}';

interface ObjectApi {
  readById(input: { id: string }): Promise<{ bytes: string; mediaType: string }>;
}

const ObjectApi = moduleApi<ObjectApi>()("stored-object");

const cancelled: string[] = [];
const ended: string[] = [];

function objectStream(id: string, bytes: string): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(bytes));
      controller.close();
    },
    cancel() {
      cancelled.push(id);
    },
  });
}

async function* twoEvents(): AsyncGenerator<RestEvent> {
  try {
    yield { event: "tick", data: "one" };
    yield { id: "2", data: "two\nlines" };
  } finally {
    ended.push("events");
  }
}

async function* neverEnds(): AsyncGenerator<RestEvent> {
  try {
    for (let index = 0; ; index += 1) yield { data: String(index) };
  } finally {
    ended.push("endless");
  }
}

const application: ObjectApi = {
  readById: async ({ id }) => ({ bytes: `bytes-of-${id}`, mediaType: "text/plain" }),
};

const objects = defineRestRouter(ObjectApi)
  .withNamespace("objects")
  .withVersion(VERSION)
  .withAddressing("v1-only")
  .get("/avatar/:id", "readAvatar")
  .withParams(z.object({ id: z.string() }))
  .withAccess(publicRoute({ reason: "an avatar is shown before anyone signs in" }))
  .withResponse("bytes", { produces: "image/*" })
  .handle(async ({ app, input, response }) => {
    const row = await app.readById({ id: input.id });

    return response.buffer(row.bytes, {
      mediaType: row.mediaType,
      filename: `a"vatar-${input.id}.png`,
      cacheSeconds: 60,
    });
  })

  .get("/stream/:id", "readObject")
  .withParams(z.object({ id: z.string() }))
  .withAccess(publicRoute({ reason: "the family's own door is tested elsewhere" }))
  .withResponse("bytes", { produces: ["application/octet-stream", "text/plain"] })
  .methods(["GET", "HEAD"])
  .handle(async ({ app, input, response }) => {
    const row = await app.readById({ id: input.id });

    return response.stream(objectStream(input.id, row.bytes), {
      mediaType: "text/plain",
      byteLength: row.bytes.length,
    });
  })

  .get("/signed/:id", "readSignedObject")
  .withParams(z.object({ id: z.string() }))
  .withAccess(publicRoute({ reason: "the family's own door is tested elsewhere" }))
  .withResponse("bytes", { produces: "application/octet-stream" })
  .handle(({ input, response }) =>
    response.storedAt(`https://store.example/${input.id}?signature=abc`, { seconds: 300 }),
  )

  .get("/refused-stream", "refusedStream")
  .withAccess(publicRoute({ reason: "the family's own door is tested elsewhere" }))
  .withResponse("bytes", { produces: "application/json" })
  .handle(({ response }) =>
    response.stream(
      (async function* () {
        yield new TextEncoder().encode('{"error":"provider refused"}');
      })(),
      { status: 401, mediaType: "application/json", headers: { "X-Provider": "test" } },
    ),
  )

  .get("/events", "watchObjects")
  .withAccess(publicRoute({ reason: "the family's own door is tested elsewhere" }))
  .withResponse("sse", {})
  .handle(({ response }) => response.events(twoEvents()))

  .get("/endless", "watchForever")
  .withAccess(publicRoute({ reason: "the family's own door is tested elsewhere" }))
  .withResponse("sse", {})
  .handle(({ response }) => response.events(neverEnds()))

  .post("/scim/Users", "createScimUser")
  .withRawBody("text")
  .withAccess(publicRoute({ reason: "SCIM presents its own bearer token" }))
  .withResponse("protocol", { produces: "application/scim+json", because: SCIM_REASON })
  .handle(({ raw, response }) =>
    response.write({
      status: 201,
      mediaType: "application/scim+json",
      body: `{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"sent":${raw.length}}`,
      headers: { Location: "/scim/Users/1" },
    }),
  )

  .get("/hand-built", "handBuiltAnswer")
  .withAccess(publicRoute({ reason: "the family's own door is tested elsewhere" }))
  .withResponse("bytes", { produces: "text/plain" })
  // @ts-expect-error a hand-built answer is refused where it is written; the
  // request below proves the framework refuses it at runtime as well.
  .handle(() => ({ status: 200, headers: {}, body: "hand-built" }))
  .build();

const proxies = defineRestRouter(ObjectApi)
  .withNamespace("proxy")
  .withVersion(VERSION)
  .withAddressing("v1-only")
  .get("/*", "forwardAnything")
  .withAccess(publicRoute({ reason: "the upstream engine authenticates the request" }))
  .withResponse("forwarded", { because: PROXY_REASON })
  .anyMethod()
  .handle(({ request, response }) => {
    const path = new URL(request.url).pathname;

    if (!path.endsWith("/known")) return response.decline();

    return response.pass(
      new Response("forwarded", { status: 203, headers: { "Content-Type": "text/plain" } }),
    );
  })
  .build();

function objectsApp(): Hono {
  const runtime = createRestRuntime({
    identity: { authenticate: () => ({ actor: null, scope: null }) },
  });

  return runtime.mount(objects.router(), {
    app: () => application,
    credential: "public",
    onError: createErrorHandler(),
  });
}

function proxyApp(): Hono {
  const runtime = createRestRuntime({
    identity: { authenticate: () => ({ actor: null, scope: null }) },
  });

  const family = runtime.mount(proxies.router(), {
    app: () => application,
    credential: "public",
    onError: createErrorHandler(),
  });

  const host = new Hono();

  host.route("/", family);
  host.all("/api/v1/proxy/other", (context) => context.text("fell through"));

  return host;
}

describe("given a route that declares the bytes kind", () => {
  it("preserves an async byte source's status, metadata and body", async () => {
    const response = await objectsApp().request("/api/v1/objects/refused-stream");

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("x-provider")).toBe("test");
    await expect(response.json()).resolves.toEqual({ error: "provider refused" });
  });

  it("pulls async bytes on demand and closes their iterator on cancellation", async () => {
    let produced = 0;
    let closed = false;

    async function* chunks() {
      try {
        for (let index = 0; index < 100; index += 1) {
          produced += 1;
          yield new Uint8Array([index]);
        }
      } finally {
        closed = true;
      }
    }

    const producer = producerFor("bytes");

    if (!("stream" in producer)) {
      throw new Error("Expected byte producer");
    }

    const answer = producer.stream(chunks(), { mediaType: "application/octet-stream" });

    if (answer.body.form !== "stream") {
      throw new Error("Expected stream answer");
    }

    const reader = answer.body.stream.getReader();
    const first = await reader.read();

    expect(first.value).toEqual(new Uint8Array([0]));
    expect(produced).toBeLessThanOrEqual(2);
    await reader.cancel();
    expect(closed).toBe(true);
    expect(produced).toBeLessThanOrEqual(2);
  });

  /** @scenario "A route that declares bytes answers with the bytes it produced" */
  it("answers with the bytes, their length and a quoted disposition", async () => {
    const response = await objectsApp().request("/api/v1/objects/avatar/object-1");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(response.headers.get("content-length")).toBe("17");
    expect(response.headers.get("content-disposition")).toBe(DISPOSITION);
    expect(response.headers.get("cache-control")).toBe("private, max-age=60");
    await expect(response.text()).resolves.toBe("bytes-of-object-1");
  });

  describe("when the HEAD twin answers", () => {
    /** @scenario "A streamed answer is dropped for the HEAD twin" */
    it("drops the body and cancels the stream it would have written", async () => {
      const response = await objectsApp().request("/api/v1/objects/stream/object-2", {
        method: "HEAD",
      });

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("");
      expect(cancelled).toContain("object-2");
    });
  });

  describe("when the store can sign for the bytes", () => {
    /** @scenario "Bytes held in a store that can sign for them redirect the caller" */
    it("redirects the caller there for the signature's lifetime", async () => {
      const response = await objectsApp().request("/api/v1/objects/signed/object-3", {
        redirect: "manual",
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("https://store.example/object-3?signature=abc");
      expect(response.headers.get("cache-control")).toBe("private, max-age=300");
      await expect(response.text()).resolves.toBe("");
    });
  });
});

describe("given a route that declares the event-stream kind", () => {
  /** @scenario "An event stream is framed by the framework, never by the handler" */
  it("frames every event and publishes the event-stream media type", async () => {
    const response = await objectsApp().request("/api/v1/objects/events");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    await expect(response.text()).resolves.toBe(FRAMED);
  });

  describe("when the caller hangs up", () => {
    /** @scenario "An event stream is framed by the framework, never by the handler" */
    it("ends the handler's own stream rather than leaving it producing", async () => {
      const response = await objectsApp().request("/api/v1/objects/endless");

      await response.body?.cancel();

      expect(ended).toContain("endless");
    });
  });
});

describe("given a route that declares a wire we do not own", () => {
  /** @scenario "A wire we do not own is written exactly as the handler wrote it" */
  it("writes the status, media type and body unchanged", async () => {
    const response = await objectsApp().request("/api/v1/objects/scim/Users", {
      method: "POST",
      body: '{"userName":"ada"}',
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/scim+json");
    expect(response.headers.get("location")).toBe("/scim/Users/1");
    await expect(response.text()).resolves.toBe(SCIM_ANSWER);
  });
});

describe("given a route that declares the forwarded kind", () => {
  /** @scenario "A forwarding route answers with the response it was handed" */
  it("answers with the upstream response verbatim", async () => {
    const response = await proxyApp().request("/api/v1/proxy/known");

    expect(response.status).toBe(203);
    await expect(response.text()).resolves.toBe("forwarded");
  });

  describe("when it recognises nothing of its own", () => {
    /** @scenario "A forwarding route answers with the response it was handed" */
    it("declines to whatever is mounted after it", async () => {
      const response = await proxyApp().request("/api/v1/proxy/other");

      await expect(response.text()).resolves.toBe("fell through");
    });
  });
});

describe("given a handler that answers with something no producer made", () => {
  /** @scenario "An answer no producer made is refused" */
  it("refuses the answer, naming the route", async () => {
    const response = await objectsApp().request("/api/v1/objects/hand-built");

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain("internal");
  });
});

describe("given a declaration that says too little or too much", () => {
  /** @scenario "The two kinds that write a foreign wire must say why" */
  it("refuses a foreign wire declared with a blank reason", () => {
    expect(() =>
      defineRestRouter(ObjectApi)
        .withNamespace("refusals")
        .withVersion(VERSION)
        .get("/one", "one")
        .withResponse("protocol", { produces: "application/xml", because: "  " }),
    ).toThrow(/writes a protocol answer/);
  });

  /** @scenario "A route answers one way" */
  it("refuses a route that declares both a schema and a kind", () => {
    expect(() =>
      defineRestRouter(ObjectApi)
        .withNamespace("refusals")
        .withVersion(VERSION)
        .get("/two", "two")
        .withOutput(z.object({ id: z.string() }))
        .withResponse("bytes", { produces: "text/plain" }),
    ).toThrow(/answer twice/);
  });

  it("refuses a bytes route that publishes no media type", () => {
    expect(() =>
      defineRestRouter(ObjectApi)
        .withNamespace("refusals")
        .withVersion(VERSION)
        .get("/three", "three")
        .withResponse("bytes", { produces: [] }),
    ).toThrow(/names no media type/);
  });
});

describe("given the document is generated for a declared kind", () => {
  /** @scenario "A declared kind publishes its media types in the document" */
  it("publishes the media types it named and no schema", async () => {
    const specification = await generateSpecs(objectsApp(), { excludeStaticFile: false });
    const answers = specification.paths?.["/api/v1/objects/stream/{id}"]?.get?.responses;

    expect(answers?.["200"]).toEqual({
      description: expect.any(String),
      content: { "application/octet-stream": {}, "text/plain": {} },
    });
  });
});
