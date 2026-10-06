import { ProjectMissingCredentialsError } from "@langwatch/api";
import type { RestIdentity } from "@langwatch/api/hosting";
import { BearerIdentity, RestHost } from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { Logger } from "@langwatch/observability";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
/**
 * @vitest-environment node
 * @see modules/stored-object/specs/stored-object-file-routes.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryStoredObjectSealRepository } from "../../repositories/memory/memory.stored-object-seal.repository.ts";
import { storedObjectProcessModule } from "../../stored-object.module.ts";
import { storedObjectFileRest } from "../stored-object-file.rest.ts";
import { storedObjectRest } from "../stored-object.rest.ts";

const PROJECT = "project_1";
const OBJECT_ID = "so_absent";

/** The file door's fixed window: 120 reads a minute per caller. */
const READ_ALLOWANCE = 120;

type Scripted = {
  authz: AuthzApi;
  /** Spend the caller's whole read allowance before the read under test. */
  exhausted?: boolean;
};

function installed({ authz }: Scripted) {
  return createApp({ role: "api" })
    .withModules([storedObjectProcessModule])
    .withConfig({
      "stored-object": {
        azureSpoolRetentionConfirmed: false,
        blockLocalHttpCalls: true,
        allowedProxyHosts: [],
        isSaas: false,
        publicBaseUrl: "https://app.example",
      },
    })
    .withStores(memoryStores())
    .withObservability((observability) =>
      observability.withLogging(createApiFixture<Logger>({ warn: () => undefined })),
    )
    .provide({ authz })
    .boot();
}

/** The process's project door, reduced to its answer: the bearer names the key's project. */
const projectDoor: RestIdentity = {
  authenticate: () => {
    throw new Error("A byte read asks no permission of its key.");
  },
  identify: ({ request }) => {
    const projectId = request.headers.get("authorization")?.replace("Bearer key-for:", "");
    if (!projectId) throw new ProjectMissingCredentialsError();

    return { actor: null, scope: { tier: "project", id: projectId } };
  },
};

function restHost(): RestHost {
  const closed = BearerIdentity.create({ name: "unconfigured", token: undefined });

  return RestHost.create({
    identities: {
      project: projectDoor,
      organization: closed,
      api_key: closed,
      scim_token: closed,
      instance_admin: closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => undefined },
  });
}

async function readThroughInstalledModule({
  authz,
  exhausted = false,
  path,
  headers = { authorization: `Bearer key-for:${PROJECT}` },
  routes = storedObjectFileRest,
}: Scripted & {
  path: string;
  headers?: Record<string, string>;
  routes?: typeof storedObjectFileRest | typeof storedObjectRest;
}) {
  const runtime = await installed({ authz });

  try {
    const host = restHost();
    const provided = runtime.module(storedObjectProcessModule).provided;
    host.mount(routes.router(), () => provided);

    for (let spent = 0; exhausted && spent < READ_ALLOWANCE; spent += 1) {
      await host.app.request(new Request(`http://api.test${path}`, { headers }));
    }
    const response = await host.app.request(new Request(`http://api.test${path}`, { headers }));

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
  describe("when a project key reads an object by project and id", () => {
    /** @scenario "the installed module answers a file read through the process's project door" */
    it("reaches the read and answers 404 for an object the project does not hold", async () => {
      const read = await readThroughInstalledModule({
        authz: permitted(),
        path: `/api/files/${PROJECT}/${OBJECT_ID}`,
      });

      expect({ status: read.status, code: JSON.parse(read.body).code }).toEqual({
        status: 404,
        code: "stored_object_not_found",
      });
    });
  });

  describe("when the same key reads it by the legacy id-only URL", () => {
    /** @scenario "the installed module answers a file read through the process's project door" */
    it("answers 404 when no owner resolves", async () => {
      const read = await readThroughInstalledModule({
        authz: permitted(),
        path: `/api/files/${OBJECT_ID}`,
      });

      expect({ status: read.status, code: JSON.parse(read.body).code }).toEqual({
        status: 404,
        code: "stored_object_not_found",
      });
    });
  });

  describe("when the caller has spent its read allowance", () => {
    /** @scenario "the installed module refuses a caller past its read allowance" */
    it("answers 429 with a retry hint", async () => {
      const read = await readThroughInstalledModule({
        authz: permitted(),
        exhausted: true,
        path: `/api/files/${PROJECT}/${OBJECT_ID}`,
      });

      expect({
        status: read.status,
        code: JSON.parse(read.body).code,
        retryAfter: Number(read.headers["retry-after"]),
      }).toEqual({
        status: 429,
        code: "stored_object_files_rate_limited",
        retryAfter: expect.toSatisfy((seconds: number) => seconds > 0 && seconds <= 60),
      });
    });
  });

  describe("when the request carries a session cookie and no key", () => {
    /** @scenario "the installed module refuses a file read with no key" */
    it("answers 401 at the door", async () => {
      const read = await readThroughInstalledModule({
        authz: permitted(),
        headers: { cookie: "session=user-1" },
        path: `/api/files/${PROJECT}/${OBJECT_ID}`,
      });

      expect(read.status).toBe(401);
    });
  });

  describe("when a key for another project reads through a URL naming this one", () => {
    /** @scenario "the installed module refuses a key of another project" */
    it("answers 403 and reads nothing", async () => {
      const read = await readThroughInstalledModule({
        authz: permitted(),
        headers: { authorization: "Bearer key-for:project_2" },
        path: `/api/files/${PROJECT}/${OBJECT_ID}`,
      });

      expect(read.status).toBe(403);
    });
  });

  describe("when a read URL carries claims written by hand in place of a seal", () => {
    const claims = JSON.stringify({
      kind: "read",
      projectId: PROJECT,
      objectId: OBJECT_ID,
      expiresAt: "2999-01-01T00:00:00.000Z",
    });
    const contentPath = (sig: string) =>
      `/api/stored-objects/${OBJECT_ID}/content?${new URLSearchParams({ sig })}`;

    /** @scenario "the installed module on memory stores refuses a signature written by hand" */
    it("answers 401 and serves nothing", async () => {
      const read = await readThroughInstalledModule({
        authz: permitted(),
        headers: {},
        routes: storedObjectRest,
        path: contentPath(claims),
      });

      expect(read.status).toBe(401);
    });

    /** @scenario "the installed module on memory stores refuses a signature written by hand" */
    it("opens a seal made under the process's own key, which shows no claim in the clear, and reaches the read", async () => {
      const sealed = MemoryStoredObjectSealRepository.create().seal(claims);

      const read = await readThroughInstalledModule({
        authz: permitted(),
        headers: {},
        routes: storedObjectRest,
        path: contentPath(sealed),
      });

      expect({ inTheClear: sealed.includes(OBJECT_ID), status: read.status }).toEqual({
        inTheClear: false,
        status: 404,
      });
    });
  });
});
