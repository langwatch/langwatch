/**
 * @vitest-environment node
 * @see modules/stored-object/specs/stored-object-file-routes.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  BearerIdentity,
  BrowserSessionIdentity,
  RestHost,
  SessionReader,
} from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { createApp } from "@langwatch/kernel";
import type { Logger } from "@langwatch/observability";
import { memoryStores } from "@langwatch/process-stores";
import { describe, expect, it } from "vitest";

import { storedObjectServer } from "../../stored-object.server.ts";
import { storedObjectFileRest } from "../stored-object-file.rest.ts";

const PROJECT = "project_1";
const OBJECT_ID = "so_absent";

type Scripted = {
  authz: AuthzApi;
  allowed?: boolean;
};

function installed({ authz, allowed = true }: Scripted) {
  return createApp({ role: "api" })
    .withModules([storedObjectServer])
    .withConfig({
      "stored-object": {
        azureSpoolRetentionConfirmed: false,
        blockLocalHttpCalls: true,
        allowedProxyHosts: [],
      },
    })
    .withStores(memoryStores())
    .withMember("encryption", {
      encrypt: (value: string) => value,
      decrypt: (value: string) => value,
    })
    .withMember("publicBaseUrl", "https://app.example")
    .withMember("rateLimiter", {
      check: async () => (allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: 30 }),
    })
    .withAnalytical(createApiFixture<ClickHouseQueryClient>({ query: async () => ({ rows: [] }) }))
    .withObservability((observability) =>
      observability.withLogging(createApiFixture<Logger>({ warn: () => undefined })),
    )
    .provide({ authz })
    .boot();
}

function restHost(authz: AuthzApi): RestHost {
  const closed = BearerIdentity.create({ name: "unconfigured", token: undefined });
  const sessions = SessionReader.create({
    verify: async (request) =>
      request.headers.get("cookie") === "session=user-1" ? { userId: "user-1" } : null,
  });

  return RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      apiKey: closed,
      scimToken: closed,
      "instance-admin": closed,
      browser: BrowserSessionIdentity.create(sessions, authz),
    },
    bearers: () => closed,
    audit: { record: async () => undefined },
  });
}

async function readThroughInstalledModule({
  authz,
  allowed,
  path,
  cookie = "session=user-1",
}: Scripted & { path: string; cookie?: string }) {
  const runtime = await installed({ authz, ...(allowed === undefined ? {} : { allowed }) });

  try {
    const host = restHost(authz);
    const provided = runtime.module(storedObjectServer).provided;
    host.mount(storedObjectFileRest.router(), () => provided);

    const response = await host.app.request(
      new Request(`http://api.test${path}`, { headers: { cookie } }),
    );

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    };
  } finally {
    await runtime.stop();
  }
}

const permitted = () =>
  createApiFixture<AuthzApi>({ authorizeProjectPermission: async () => undefined });

describe("given the stored-object module installed over memory stores", () => {
  describe("when a signed-in member with the permission reads an object by project and id", () => {
    /** @scenario "the installed module answers a file read through the process's verifier" */
    it("reaches the read and answers 404 for an object the project does not hold", async () => {
      const read = await readThroughInstalledModule({
        authz: permitted(),
        path: `/api/files/${PROJECT}/${OBJECT_ID}`,
      });

      expect({ status: read.status, body: read.body }).toEqual({
        status: 404,
        body: '{"status":"not_found"}',
      });
    });
  });

  describe("when the same member reads it by the legacy id-only URL", () => {
    /** @scenario "the installed module answers a file read through the process's verifier" */
    it("answers 404 when no owner resolves", async () => {
      const read = await readThroughInstalledModule({
        authz: permitted(),
        path: `/api/files/${OBJECT_ID}`,
      });

      expect({ status: read.status, body: read.body }).toEqual({
        status: 404,
        body: '{"status":"not_found"}',
      });
    });
  });

  describe("when the caller has spent its read allowance", () => {
    /** @scenario "the installed module refuses a caller past its read allowance" */
    it("answers 429 with a retry hint", async () => {
      const read = await readThroughInstalledModule({
        authz: permitted(),
        allowed: false,
        path: `/api/files/${PROJECT}/${OBJECT_ID}`,
      });

      expect({
        status: read.status,
        body: read.body,
        retryAfter: read.headers["retry-after"],
      }).toEqual({ status: 429, body: '{"error":"rate_limited"}', retryAfter: "30" });
    });
  });

  describe("when the request carries no session", () => {
    /** @scenario "the installed module refuses a file read with no credential" */
    it("answers 401 at the door", async () => {
      const read = await readThroughInstalledModule({
        authz: permitted(),
        cookie: "",
        path: `/api/files/${PROJECT}/${OBJECT_ID}`,
      });

      expect(read.status).toBe(401);
    });
  });
});
