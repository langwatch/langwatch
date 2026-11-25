// dev/nx/remote-cache-plugin.mjs and dev/nx/remote-cache/,
// bound to specs/ci/nx-remote-cache.feature.

import assert from "node:assert/strict";
import { request } from "node:http";
import { describe, it } from "node:test";

import { profileFor } from "../remote-cache-plugin.mjs";
import { credentialSource } from "../remote-cache/credentials.mjs";
import { signedHeaders } from "../remote-cache/s3.mjs";
import { cacheScope } from "../remote-cache/scope.mjs";
import { createCacheServer } from "../remote-cache/server.mjs";

const prefixes = (scope) => scope.read.map((r) => r.prefix);
const ci = (extra) => ({ GITHUB_ACTIONS: "true", ...extra });

const memoryStore = () => {
  const objects = new Map();
  return {
    objects,
    get: async (key) => {
      const value = objects.get(key);
      if (!value) return null;
      const { Readable } = await import("node:stream");
      return { body: Readable.from([value]), length: value.length };
    },
    put: async (key, body) => {
      const chunks = [];
      for await (const chunk of body) chunks.push(chunk);
      if (objects.has(key)) return 412;
      objects.set(key, Buffer.concat(chunks));
      return 200;
    },
  };
};

const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

const call = ({ port, method, path, body, token = "t" }) =>
  new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { "content-length": body.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });

const withServer = async ({ scope, store, maxUploadBytes = 1024 }, run) => {
  const server = createCacheServer({ scope, token: "t", store, maxUploadBytes });
  const port = await listen(server);
  try {
    await run(port);
  } finally {
    server.close();
  }
};

describe("Nx remote cache", () => {
  /** @scenario "Main reads and writes only CI namespaces" */
  it("gives main the CI namespaces only", () => {
    const scope = cacheScope({
      env: ci({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" }),
    });
    assert.deepEqual(prefixes(scope), ["main/", "pr/"]);
    assert.equal(scope.write, "main/");
    assert.ok(!prefixes(scope).some((p) => p.startsWith("branch/")));
  });

  /** @scenario "A pull request writes pr/ and reads its own branch last" */
  it("reads the pull request's own branch last and writes pr/", () => {
    const scope = cacheScope({
      env: ci({
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_REF: "refs/pull/1/merge",
        GITHUB_HEAD_REF: "feat/x",
      }),
    });
    assert.deepEqual(prefixes(scope), ["pr/", "main/", "branch/feat_x/"]);
    assert.equal(scope.write, "pr/");
    assert.equal(scope.taintedWrite, "branch/feat_x/");
  });

  /** @scenario "A pull request that used a laptop entry stops writing pr/" */
  it("moves a job's writes to the branch once it used a laptop entry", async () => {
    const store = memoryStore();
    store.objects.set("branch/feat_x/111", Buffer.from("laptop"));
    const scope = cacheScope({
      env: ci({ GITHUB_EVENT_NAME: "pull_request", GITHUB_HEAD_REF: "feat/x" }),
    });
    await withServer({ scope, store }, async (port) => {
      await call({ port, method: "PUT", path: "/v1/cache/222", body: Buffer.from("before") });
      assert.equal((await call({ port, method: "GET", path: "/v1/cache/111" })).body, "laptop");
      await call({ port, method: "PUT", path: "/v1/cache/333", body: Buffer.from("after") });
    });
    assert.ok(store.objects.has("pr/222"));
    assert.ok(store.objects.has("branch/feat_x/333"));
    assert.ok(!store.objects.has("pr/333"));
  });

  /** @scenario "A laptop writes only its own branch" */
  it("lets a laptop write only its branch", () => {
    const scope = cacheScope({ env: {}, localBranch: "feat/x" });
    assert.deepEqual(prefixes(scope), ["branch/feat_x/", "main/", "pr/"]);
    assert.equal(scope.write, "branch/feat_x/");
  });

  /** @scenario "A laptop on main or a detached head only reads" */
  it("makes a laptop on main or a detached head read only", () => {
    assert.equal(cacheScope({ env: {}, localBranch: "main" }).write, null);
    assert.equal(cacheScope({ env: {}, localBranch: "HEAD" }).write, null);
  });

  /** @scenario "Other CI events get no remote cache" */
  it("turns the cache off for other CI events", () => {
    assert.equal(
      cacheScope({ env: ci({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v1" }) }),
      null,
    );
    assert.equal(
      cacheScope({ env: ci({ GITHUB_EVENT_NAME: "schedule", GITHUB_REF: "refs/heads/main" }) }),
      null,
    );
    assert.equal(
      cacheScope({ env: ci({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/feat/x" }) }),
      null,
    );
    assert.equal(cacheScope({ env: ci({ GITHUB_EVENT_NAME: "pull_request_target" }) }), null);
    assert.equal(cacheScope({ env: ci({ GITHUB_EVENT_NAME: "merge_group" }) }), null);
  });

  /** @scenario "No AWS access leaves Nx on its local cache" */
  it("needs the AWS profile and CLI on a laptop, and leaves CI to its action", () => {
    const yes = () => true;
    const no = () => false;
    assert.equal(profileFor({ env: {}, profileExists: no, awsCli: yes }), null);
    assert.equal(profileFor({ env: {}, profileExists: yes, awsCli: no }), null);
    assert.equal(profileFor({ env: {}, profileExists: yes, awsCli: yes }), "lw-dev-sso");
    assert.equal(
      profileFor({ env: { LANGWATCH_NX_REMOTE_CACHE: "0" }, profileExists: yes, awsCli: yes }),
      null,
    );
    assert.equal(
      profileFor({ env: ci({ AWS_ACCESS_KEY_ID: "a" }), profileExists: yes, awsCli: yes }),
      null,
    );
  });

  /** @scenario "An S3 failure is a miss, never a failed run" */
  it("answers a miss and a stored write when S3 fails", async () => {
    const broken = {
      get: async () => {
        throw new Error("no network");
      },
      put: async () => {
        throw new Error("no network");
      },
    };
    const scope = cacheScope({ env: {}, localBranch: "feat/x" });
    await withServer({ scope, store: broken }, async (port) => {
      assert.equal((await call({ port, method: "GET", path: "/v1/cache/1" })).status, 404);
      assert.equal(
        (await call({ port, method: "PUT", path: "/v1/cache/1", body: Buffer.from("x") })).status,
        200,
      );
    });
    let loads = 0;
    const credentials = credentialSource({
      profile: "lw-dev-sso",
      env: {},
      load: async () => {
        loads++;
        throw new Error("SSO session expired");
      },
    });
    assert.equal(await credentials(), null);
    assert.equal(await credentials(), null);
    assert.equal(loads, 1);
  });

  /** @scenario "An entry is never replaced" */
  it("keeps the first entry stored under a hash", async () => {
    const store = memoryStore();
    const scope = cacheScope({ env: {}, localBranch: "feat/x" });
    await withServer({ scope, store }, async (port) => {
      await call({ port, method: "PUT", path: "/v1/cache/9", body: Buffer.from("first") });
      await call({ port, method: "PUT", path: "/v1/cache/9", body: Buffer.from("second") });
      assert.equal((await call({ port, method: "GET", path: "/v1/cache/9" })).body, "first");
    });
  });

  /** @scenario "Oversized entries are not uploaded" */
  it("skips uploads over the limit and still answers success", async () => {
    const store = memoryStore();
    const scope = cacheScope({ env: {}, localBranch: "feat/x" });
    await withServer({ scope, store, maxUploadBytes: 4 }, async (port) => {
      assert.equal(
        (await call({ port, method: "PUT", path: "/v1/cache/5", body: Buffer.from("too big") }))
          .status,
        200,
      );
    });
    assert.equal(store.objects.size, 0);
  });

  it("refuses a request without the server's token", async () => {
    const scope = cacheScope({ env: {}, localBranch: "feat/x" });
    await withServer({ scope, store: memoryStore() }, async (port) => {
      assert.equal(
        (await call({ port, method: "GET", path: "/v1/cache/1", token: "wrong" })).status,
        401,
      );
    });
  });

  /** @scenario "Requests are signed with AWS Signature Version 4" */
  it("matches AWS's published SigV4 example for an S3 GET", () => {
    const headers = signedHeaders({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      region: "us-east-1",
      credentials: {
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      },
      headers: { range: "bytes=0-9" },
      now: new Date("2013-05-24T00:00:00Z"),
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
    assert.match(
      headers.authorization,
      /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/,
    );
  });
});
