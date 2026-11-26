// dev/nx/remote-cache-plugin.mjs and dev/nx/remote-cache/,
// bound to specs/ci/nx-remote-cache.feature.

import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { describe, it } from "node:test";

import { laptopAccess } from "../remote-cache-plugin.mjs";
import { credentialSource } from "../remote-cache/credentials.mjs";
import { gateStore } from "../remote-cache/gate.mjs";
import { signedHeaders } from "../remote-cache/s3.mjs";
import { cacheScope } from "../remote-cache/scope.mjs";
import { createCacheServer } from "../remote-cache/server.mjs";
import { afterLogin, setupStep } from "../remote-cache/setup.mjs";

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
    put: async (key, body, _length, { overwrite = false } = {}) => {
      const chunks = [];
      for await (const chunk of body) chunks.push(chunk);
      if (objects.has(key) && !overwrite) return 412;
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

// The cache gate and S3 in one local server. "member" and "outsider" are tokens GitHub
// accepts; any other token is refused. The gate's rules are the ones in langwatch-saas
// infrastructure/live/dev-nx-cache/gate/index.mjs.
const withGate = async (run) => {
  const objects = new Map();
  const asked = [];
  const readBody = async (req) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks);
  };
  let base;
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    if (req.url === "/gate") {
      const token = (req.headers.authorization ?? "").replace("Bearer ", "");
      const ask = JSON.parse(body.toString());
      asked.push({ get: ask.get ?? [], put: ask.put ?? [] });
      if (token !== "member" && token !== "outsider") return res.writeHead(401).end("{}");
      const member = token === "member";
      const get = {};
      for (const key of ask.get ?? []) {
        if (member || key.startsWith("main/")) get[key] = `${base}/s3/${key}`;
      }
      const put = {};
      for (const { key } of ask.put ?? []) {
        if (member && key.startsWith("branch/")) put[key] = `${base}/s3/${key}`;
      }
      return res.writeHead(200).end(JSON.stringify({ member, expiresIn: 300, get, put }));
    }
    const key = req.url.replace(/^\/s3\//, "");
    if (req.method === "GET") {
      const value = objects.get(key);
      return value ? res.writeHead(200).end(value) : res.writeHead(403).end();
    }
    if (req.headers["if-none-match"] !== "*") return res.writeHead(403).end();
    if (objects.has(key)) return res.writeHead(412).end();
    objects.set(key, body);
    return res.writeHead(200).end();
  });
  const port = await listen(server);
  base = `http://127.0.0.1:${port}`;
  try {
    await run({ url: `${base}/gate`, objects, asked });
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
    // A later job of the same branch restores caches this server never saw.
    await withServer({ scope, store }, async (port) => {
      await call({ port, method: "PUT", path: "/v1/cache/444", body: Buffer.from("later") });
    });
    assert.ok(store.objects.has("branch/feat_x/444"));
    assert.ok(!store.objects.has("pr/444"));
  });

  /** @scenario "A pull request that used a laptop entry stops writing pr/" */
  it("never serves a laptop entry it could not mark, and never writes pr/ on an unknown marker", async () => {
    const store = memoryStore();
    store.objects.set("branch/feat_x/111", Buffer.from("laptop"));
    const failing = {
      get: store.get,
      put: async (key, body, length, opts) =>
        key.endsWith("tainted") ? 500 : store.put(key, body, length, opts),
    };
    const scope = cacheScope({
      env: ci({ GITHUB_EVENT_NAME: "pull_request", GITHUB_HEAD_REF: "feat/x" }),
    });
    await withServer({ scope, store: failing }, async (port) => {
      assert.equal((await call({ port, method: "GET", path: "/v1/cache/111" })).status, 404);
    });
    const unreadable = {
      get: async (key) => {
        if (key.endsWith("tainted")) throw new Error("no network");
        return store.get(key);
      },
      put: store.put,
    };
    await withServer({ scope, store: unreadable }, async (port) => {
      await call({ port, method: "PUT", path: "/v1/cache/555", body: Buffer.from("x") });
    });
    assert.ok(!store.objects.has("pr/555"));
    assert.ok(store.objects.has("branch/feat_x/555"));
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

  /** @scenario "No GitHub login leaves Nx on its local cache" */
  it("needs a gate and a GitHub token on a laptop, and leaves CI to its action", () => {
    const token = () => "gho_x";
    const none = () => null;
    const gate = { LANGWATCH_NX_REMOTE_CACHE_GATE: "https://gate.example" };
    assert.equal(laptopAccess({ env: gate, githubToken: none }), null);
    assert.equal(
      laptopAccess({ env: { LANGWATCH_NX_REMOTE_CACHE_GATE: "" }, githubToken: token }),
      null,
    );
    assert.deepEqual(laptopAccess({ env: gate, githubToken: token }), {
      gate: "https://gate.example",
      githubToken: "gho_x",
    });
    assert.equal(
      laptopAccess({ env: { ...gate, LANGWATCH_NX_REMOTE_CACHE: "0" }, githubToken: token }),
      null,
    );
    assert.equal(laptopAccess({ env: ci(gate), githubToken: token }), null);
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
    assert.equal(await credentialSource({ env: {} })(), null);
    const expiring = credentialSource({
      env: {
        AWS_ACCESS_KEY_ID: "a",
        AWS_SECRET_ACCESS_KEY: "s",
        AWS_CREDENTIAL_EXPIRATION: new Date(60_000).toISOString(),
      },
      now: () => 0,
    });
    assert.equal(await expiring(), null);
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

  /** @scenario "A member's laptop reads every namespace and writes its branch through the gate" */
  it("reads and writes S3 through URLs the gate signed for a member", async () => {
    await withGate(async (gate) => {
      gate.objects.set("pr/7", Buffer.from("from a pull request"));
      const store = gateStore({ url: gate.url, token: "member" });
      const scope = cacheScope({ env: {}, localBranch: "feat/x" });
      await withServer({ scope, store }, async (port) => {
        const hit = await call({ port, method: "GET", path: "/v1/cache/7" });
        assert.deepEqual([hit.status, hit.body], [200, "from a pull request"]);
        await call({ port, method: "PUT", path: "/v1/cache/8", body: Buffer.from("mine") });
        await call({ port, method: "PUT", path: "/v1/cache/8", body: Buffer.from("again") });
      });
      assert.equal(gate.objects.get("branch/feat_x/8").toString(), "mine");
      // One gate call signs every namespace a lookup tries.
      assert.deepEqual(gate.asked[0], { get: ["branch/feat_x/7", "main/7", "pr/7"], put: [] });
    });
  });

  /** @scenario "A laptop outside the GitHub org reads main only" */
  it("reads only main/ and writes nothing for someone outside the org", async () => {
    await withGate(async (gate) => {
      gate.objects.set("main/1", Buffer.from("from main"));
      gate.objects.set("pr/2", Buffer.from("from a pull request"));
      const store = gateStore({ url: gate.url, token: "outsider" });
      const scope = cacheScope({ env: {}, localBranch: "feat/x" });
      await withServer({ scope, store }, async (port) => {
        assert.equal((await call({ port, method: "GET", path: "/v1/cache/1" })).body, "from main");
        assert.equal((await call({ port, method: "GET", path: "/v1/cache/2" })).status, 404);
        const put = await call({
          port,
          method: "PUT",
          path: "/v1/cache/3",
          body: Buffer.from("x"),
        });
        assert.equal(put.status, 200);
      });
      assert.equal(gate.objects.has("branch/feat_x/3"), false);
    });
  });

  /** @scenario "A token the gate refuses turns the cache off" */
  it("misses and stops asking the gate after it refuses the token", async () => {
    await withGate(async (gate) => {
      gate.objects.set("main/1", Buffer.from("from main"));
      const lines = [];
      const store = gateStore({ url: gate.url, token: "expired", log: (l) => lines.push(l) });
      const scope = cacheScope({ env: {}, localBranch: "feat/x" });
      await withServer({ scope, store }, async (port) => {
        assert.equal((await call({ port, method: "GET", path: "/v1/cache/1" })).status, 404);
        assert.equal((await call({ port, method: "GET", path: "/v1/cache/1" })).status, 404);
      });
      assert.equal(gate.asked.length, 1);
      assert.match(lines.join("\n"), /gh auth login/);
    });
  });

  /** @scenario "A gate that is down is a miss, never a failed run" */
  it("answers a miss and a stored write when the gate is down", async () => {
    const server = createServer((_req, res) => res.writeHead(503).end());
    const port = await listen(server);
    const store = gateStore({ url: `http://127.0.0.1:${port}/gate`, token: "member" });
    server.close();
    const scope = cacheScope({ env: {}, localBranch: "feat/x" });
    await withServer({ scope, store }, async (cachePort) => {
      assert.equal(
        (await call({ port: cachePort, method: "GET", path: "/v1/cache/1" })).status,
        404,
      );
      const put = await call({
        port: cachePort,
        method: "PUT",
        path: "/v1/cache/1",
        body: Buffer.from("x"),
      });
      assert.equal(put.status, 200);
    });
  });

  /** @scenario "Dev asks for a GitHub login once and never blocks" */
  it("asks a person once, tells everyone else in one line, and remembers", () => {
    const base = { env: {}, gate: "https://gate.example", ghInstalled: true, remembered: null };
    assert.deepEqual(setupStep({ ...base, loggedIn: true, interactive: true }), {
      action: "none",
      remember: "on",
    });
    assert.deepEqual(setupStep({ ...base, loggedIn: false, interactive: true }), {
      action: "login",
    });
    assert.equal(setupStep({ ...base, loggedIn: false, interactive: false }).action, "say");
    assert.equal(setupStep({ ...base, loggedIn: false, interactive: false }).remember, undefined);
    assert.equal(
      setupStep({ ...base, loggedIn: false, interactive: true, remembered: "declined" }).action,
      "none",
    );
    assert.deepEqual(
      setupStep({ ...base, ghInstalled: false, loggedIn: false, interactive: true }),
      {
        action: "say",
        line: setupStep({ ...base, ghInstalled: false, loggedIn: false, interactive: true }).line,
        remember: "no-gh",
      },
    );
    assert.equal(
      setupStep({ ...base, gate: "", loggedIn: false, interactive: true }).action,
      "none",
    );
    assert.equal(
      setupStep({ ...base, env: { CI: "1" }, loggedIn: false, interactive: true }).action,
      "none",
    );
    assert.deepEqual(afterLogin({ loggedIn: true }), { action: "none", remember: "on" });
    assert.equal(afterLogin({ loggedIn: false }).remember, "declined");
  });
});
