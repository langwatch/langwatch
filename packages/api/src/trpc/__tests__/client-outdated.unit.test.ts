/**
 * A tab still open on the release before plain JSON is told to reload, never served.
 * @see packages/api/specs/trpc-framework.feature
 */

import type { PermissionDecision } from "@langwatch/authorization";
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createApiDouble } from "../../__tests__/api-double.ts";
import type { Authorize } from "../../access/access.ts";
import { SessionReader } from "../../hosting/session-reader.ts";
import { composeTrpcRouters } from "../compose.ts";
import { TrpcHost } from "../host.ts";
import { defineTrpcRouter } from "../runtime.ts";
import { SseLane } from "../sse.ts";

type LogRecord = { level: string; fields: unknown; message: string | undefined };

const logged = vi.hoisted((): LogRecord[] => []);

vi.mock("@langwatch/observability", async (importOriginal) => {
  const at =
    (level: string) =>
    (fields: unknown, message?: string): void => {
      logged.push({ level, fields, message });
    };

  return {
    ...((await importOriginal()) as object),
    createLogger: () => ({
      debug: at("debug"),
      info: at("info"),
      warn: at("warn"),
      error: at("error"),
    }),
  };
});

interface EchoApi {
  echo(input: { projectId: string; id: string }): { id: string };
}

const EchoApi = moduleApi<EchoApi>()("annotation");

const reads = defineTrpcRouter(
  EchoApi,
  defineTrpcContract("echoes")
    .query("echo")
    .withInput(z.object({ projectId: z.string(), id: z.string() }))
    .withOutput(z.object({ id: z.string() }))
    .build(),
)
  .procedure("echo")
  .withPermission("annotations:view")
  .handle(({ app, input }) => app.echo(input))
  .build();

async function call(input: unknown): Promise<{ status: number; body: unknown }> {
  const authz = createApiDouble<Authorize>({
    getDecision: async (): Promise<PermissionDecision> => ({
      permitted: true,
      organizationRole: "MEMBER",
    }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
    organizationOf: async () => null,
    projectKindOf: async () => "application",
  });
  const trpc = TrpcHost.create({
    sessions: SessionReader.create({ verify: async () => ({ userId: "sam" }) }),
    authz,
  });
  const application: EchoApi = { echo: ({ id }) => ({ id }) };
  trpc.mount(composeTrpcRouters("echoes", [reads]), () => application);

  const request = new Request(
    `http://api.test${TrpcHost.path}/echoes.echo?input=${encodeURIComponent(JSON.stringify(input))}`,
  );
  const response = await fetchRequestHandler({
    endpoint: TrpcHost.path,
    req: request,
    router: trpc.router,
    createContext: () => trpc.context({ request }),
  });

  return { status: response.status, body: await response.json() };
}

function liveLane(opened: string[]) {
  return SseLane.create({
    members: {
      createCaller: async () => ({
        presence: {
          watch: async function* (input: unknown) {
            opened.push(JSON.stringify(input));
            yield { kind: "join" };
          },
        },
      }),
      procedureTypeAt: () => "subscription",
    },
  });
}

function subscribe(lane: SseLane, input: unknown): Promise<Response> {
  return lane.answer(
    new Request(
      `http://api.test/api/sse/presence/watch?input=${encodeURIComponent(JSON.stringify(input))}`,
      { headers: { "sec-fetch-site": "same-origin" } },
    ),
    new Headers(),
  );
}

describe("given a procedure whose input is a plain object", () => {
  /** @scenario "A call wrapped in the old transformer envelope is told its page is out of date" */
  it("answers an enveloped call with client_outdated and logs one info line", async () => {
    logged.length = 0;

    const answer = await call({
      json: { projectId: "p1", id: "row-1" },
      meta: { values: {} },
    });

    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({
      error: { data: { error: { code: "client_outdated" } } },
    });
    expect(logged.filter((record) => record.level === "info")).toEqual([
      expect.objectContaining({ message: "An outdated client was told to reload" }),
    ]);
    expect(logged.filter((record) => record.level === "error")).toEqual([]);
  });

  /** @scenario "A plain JSON call is untouched by the outdated-client check" */
  it("runs a plain JSON call", async () => {
    const answer = await call({ projectId: "p1", id: "row-1" });

    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ result: { data: { id: "row-1" } } });
  });
});

describe("given a live subscription procedure", () => {
  /** @scenario "A live subscription opened with the old envelope is told its page is out of date" */
  it("refuses an enveloped input with client_outdated before the caller is built", async () => {
    logged.length = 0;
    const opened: string[] = [];

    await expect(subscribe(liveLane(opened), { json: { projectId: "p1" } })).rejects.toMatchObject({
      code: "client_outdated",
      httpStatus: 400,
    });
    expect(opened).toEqual([]);
    expect(logged.filter((record) => record.level === "info")).toEqual([
      expect.objectContaining({ message: "An outdated client was told to reload" }),
    ]);
    expect(logged.filter((record) => record.level === "error")).toEqual([]);
  });

  /** @scenario "A live subscription opened with plain JSON input opens as before" */
  it("opens the stream for a plain JSON input", async () => {
    const opened: string[] = [];

    const response = await subscribe(liveLane(opened), { projectId: "p1" });
    const stream = await response.text();

    expect(response.status).toBe(200);
    expect(stream).toContain('"kind":"join"');
    expect(opened).toEqual([JSON.stringify({ projectId: "p1" })]);
  });
});
