/**
 * A caller pins a dated family's version by URL or by `X-API-Version`, through one path; a
 * family superseded at a later date keeps only its own dates.
 * Spec: packages/api/specs/public-rest.feature.
 */
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { publicRoute } from "../../access/access.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { defineRestRouter } from "../declaration.ts";
import { RestHost } from "../host.ts";

const FIRST = "2026-01-15";
const SECOND = "2026-08-07";

type ThingApi = Readonly<{ serve(input: { id?: string; body?: string }): { served: string } }>;

const ThingApi = moduleApi<ThingApi>()("annotation");

const PUBLIC = publicRoute({ reason: "the test reads nothing private" });
const served = z.object({ served: z.string() });

/** One registration of `/api/things`: a list, a read by id and a create echoing its body. */
function things({ version, supersededAt }: { version: string; supersededAt?: string }) {
  const router = defineRestRouter(ThingApi).withNamespace("things").withVersion(version);

  return (supersededAt ? router.withSupersededAt(supersededAt) : router)
    .get("/", "listThings")
    .withAccess(PUBLIC)
    .withOutput(served)
    .handle(({ app }) => app.serve({}))

    .get("/:thingId", "getThing")
    .withAccess(PUBLIC)
    .withParams(z.object({ thingId: z.string() }))
    .withOutput(served)
    .handle(({ app, input }) => app.serve({ id: input.thingId }))

    .post("/", "createThing")
    .withAccess(PUBLIC)
    .withoutAudit("test route")
    .keepsRecords()
    .withInput(z.object({ name: z.string() }))
    .withOutput(served)
    .handle(({ app, input }) => app.serve({ body: input.name }))
    .build()
    .router();
}

const plain = defineRestRouter(ThingApi)
  .withNamespace("plain-things")
  .withVersion(SECOND)
  .withAddressing("v1-only")
  .get("/", "listPlainThings")
  .withAccess(PUBLIC)
  .withOutput(served)
  .handle(({ app }) => app.serve({ id: "plain" }))
  .build()
  .router();

/** Which registration answered, and with what. */
const answering =
  (registration: string): (() => ThingApi) =>
  () => ({
    serve: ({ id, body }) => ({
      served: [registration, id, body].filter((part) => part !== void 0).join(":"),
    }),
  });

function host() {
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
  const server = RestHost.create({
    authz: authorizationPort.forRequest(),
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      instance_admin: closed,
      browser: closed,
    },
    audit: { record: async () => {} },
  });

  server.mount(things({ version: FIRST, supersededAt: SECOND }), answering("first"));
  server.mount(things({ version: SECOND }), answering("second"));
  server.mount(plain, answering("plain"));

  return server;
}

async function ask(
  server: RestHost,
  path: string,
  { version, body }: { version?: string; body?: unknown } = {},
) {
  const response = await server.app.request(path, {
    method: body === void 0 ? "GET" : "POST",
    headers: {
      ...(version ? { "X-API-Version": version } : {}),
      ...(body === void 0 ? {} : { "content-type": "application/json" }),
    },
    ...(body === void 0 ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const json = (text.startsWith("{") ? JSON.parse(text) : {}) as {
    served?: string;
    code?: string;
  };

  return {
    status: response.status,
    answer: json.served ?? json.code,
    version: response.headers.get("X-API-Version"),
    versionStatus: response.headers.get("X-API-Version-Status"),
  };
}

describe("given a namespace registered at one date and superseded by a new family at a later one", () => {
  /** @scenario "An omitted date version defaults to latest" */
  it("answers the newest registration when neither the URL nor the header names a date", async () => {
    const server = host();

    expect(await ask(server, "/api/v1/things")).toEqual({
      status: 200,
      answer: "second",
      version: "latest",
      versionStatus: "latest",
    });
  });

  /** @scenario "A header can pin the optional date version" */
  it("answers a header-pinned date exactly as the same dated URL", async () => {
    const server = host();
    const pins = [FIRST, "2026-05-01", SECOND, "2026-10-26"];

    const byHeader = await Promise.all(
      pins.map((version) => ask(server, "/api/v1/things/thing-1", { version })),
    );
    const byUrl = await Promise.all(
      pins.map((version) => ask(server, `/api/v1/things/${version}/thing-1`)),
    );

    expect(byHeader).toEqual(byUrl);
    expect(byHeader.map(({ answer }) => answer)).toEqual([
      "first:thing-1",
      "first:thing-1",
      "second:thing-1",
      "second:thing-1",
    ]);
  });

  /** @scenario "A header can pin the optional date version" */
  it("re-answers a pinned request with its body", async () => {
    const server = host();

    const created = await ask(server, "/api/things", { version: FIRST, body: { name: "Kept" } });

    expect({ status: created.status, answer: created.answer }).toEqual({
      status: 200,
      answer: "first:Kept",
    });
  });

  /** @scenario "A registration superseded at a later date keeps only its own dates" */
  it("leaves latest, the bare path and the later dates to the new family", async () => {
    const server = host();

    const answers = await Promise.all(
      [
        "/api/v1/things",
        "/api/v1/things/latest",
        `/api/v1/things/${FIRST}`,
        "/api/v1/things/2026-08-06",
        `/api/v1/things/${SECOND}`,
        "/api/v1/things/2027-01-01",
      ].map(async (path) => (await ask(server, path)).answer),
    );

    expect(answers).toEqual(["second", "second", "first", "first", "second", "second"]);
  });

  /** @scenario "URL and header disagreement fails" */
  it("refuses a dated URL and a header naming different versions", async () => {
    const server = host();

    const [conflict, agreeing] = await Promise.all([
      ask(server, `/api/v1/things/${FIRST}`, { version: SECOND }),
      ask(server, `/api/v1/things/${FIRST}`, { version: FIRST }),
    ]);

    expect([conflict, agreeing].map(({ status, answer }) => ({ status, answer }))).toEqual([
      { status: 400, answer: "api_version_conflict" },
      { status: 200, answer: "first" },
    ]);
  });

  /** @scenario "A URL naming latest or preview is answered there whatever the header pins" */
  it("answers a latest URL at latest when the header pins a date, as the SDK sends it", async () => {
    const server = host();

    const answered = await ask(server, "/api/v1/things/latest/thing-1", { version: FIRST });

    expect({ status: answered.status, answer: answered.answer }).toEqual({
      status: 200,
      answer: "second:thing-1",
    });
  });

  /** @scenario "Invalid and unavailable header versions differ" */
  it("refuses a header that is no version, and finds nothing before the service existed", async () => {
    const server = host();

    const [invalid, impossible, before] = await Promise.all([
      ask(server, "/api/v1/things", { version: "v2" }),
      ask(server, "/api/v1/things", { version: "2026-02-30" }),
      ask(server, "/api/v1/things", { version: "2025-12-31" }),
    ]);

    expect([invalid, impossible, before].map(({ status }) => status)).toEqual([400, 400, 404]);
    expect([invalid.answer, impossible.answer]).toEqual([
      "invalid_api_version",
      "invalid_api_version",
    ]);
  });
});

describe("given a family that is not dated", () => {
  /** @scenario "A header on a family that is not dated changes nothing" */
  it("answers exactly as without the header", async () => {
    const server = host();

    const [pinned, bare] = await Promise.all([
      ask(server, "/api/v1/plain-things", { version: FIRST }),
      ask(server, "/api/v1/plain-things"),
    ]);

    expect(pinned).toEqual(bare);
    expect(pinned.answer).toBe("plain:plain");
  });
});
