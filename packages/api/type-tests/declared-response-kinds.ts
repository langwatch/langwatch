/**
 * Every probe here is a refusal: each line must not compile, and an unused
 * directive fails the build. Spec: packages/api/specs/declared-response-kinds.feature.
 */
import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, type FeatureApiWitness } from "@langwatch/api/rest";
import { z } from "zod";

interface ObjectApi {
  readById(input: { id: string }): Promise<{ bytes: Uint8Array }>;
}

declare const restApi: FeatureApiWitness<ObjectApi>;
declare const events: AsyncIterable<{ data: string }>;

const REASON = "the family's own door is declared elsewhere";

function family() {
  return defineRestRouter(restApi).withNamespace("objects").withVersion("2026-09-08");
}

// ---------------------------------------------------------------------------
// A kind's handler produces that kind, and nothing else
// ---------------------------------------------------------------------------

family()
  .get("/one", "one")
  .withAccess(publicRoute({ reason: REASON }))
  .withResponse("bytes", { produces: "text/plain" })
  // @ts-expect-error a whole Response is not an answer any producer made
  .handle(() => new Response("hand-built"));

family()
  .get("/two", "two")
  .withAccess(publicRoute({ reason: REASON }))
  .withResponse("bytes", { produces: "text/plain" })
  // @ts-expect-error `{ status, headers, body }` is the old raw shape, not a produced answer
  .handle(() => ({ status: 200, headers: {}, body: "hand-built" }));

family()
  .get("/three", "three")
  .withAccess(publicRoute({ reason: REASON }))
  .withResponse("bytes", { produces: "text/plain" })
  // @ts-expect-error an SSE answer is not a bytes answer, though both are produced
  .handle(({ response }) => response.events(events));

family()
  .get("/four", "four")
  .withAccess(publicRoute({ reason: REASON }))
  .withResponse("sse", {})
  // @ts-expect-error an event-stream route has no way to write bytes
  .handle(({ response }) => response.buffer("bytes", { mediaType: "text/plain" }));

family()
  .get("/five", "five")
  .withAccess(publicRoute({ reason: REASON }))
  .withResponse("redirect", {})
  // @ts-expect-error a redirecting route forwards nothing
  .handle(({ response }) => response.pass(new Response("upstream")));

// ---------------------------------------------------------------------------
// A route with no declared kind is handed no producer at all
// ---------------------------------------------------------------------------

family()
  .get("/six", "six")
  .withAccess(publicRoute({ reason: REASON }))
  .withOutput(z.object({ id: z.string() }))
  // @ts-expect-error a JSON route returns a plain value; there is no producer in its arguments
  .handle(({ response }) => {
    void response;

    return { id: "one" };
  });

family()
  .get("/seven", "seven")
  .withAccess(publicRoute({ reason: REASON }))
  .withResponse("bytes", { produces: "application/octet-stream" })
  .handle(({ response }) =>
    // @ts-expect-error the route publishes one media type, and this is not it
    response.buffer("bytes", { mediaType: "text/csv" }),
  );

// ---------------------------------------------------------------------------
// The two kinds that write a wire we do not own must say why
// ---------------------------------------------------------------------------

family()
  .get("/eight", "eight")
  .withAccess(publicRoute({ reason: REASON }))
  // @ts-expect-error a forwarded answer with no reason is an unjustified escape
  .withResponse("forwarded", {});

family()
  .post("/nine", "nine")
  .withAccess(publicRoute({ reason: REASON }))
  // @ts-expect-error a protocol answer names what it publishes and why
  .withResponse("protocol", { produces: "application/scim+json" });

family()
  .get("/ten", "ten")
  .withAccess(publicRoute({ reason: REASON }))
  // @ts-expect-error a bytes answer publishes the media types it produces
  .withResponse("bytes", {});
