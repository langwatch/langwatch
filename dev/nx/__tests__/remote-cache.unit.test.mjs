// dev/nx/remote-cache-plugin.mjs and dev/nx/remote-cache/,
// bound to specs/ci/nx-remote-cache.feature.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { laptopAccess } from "../remote-cache-plugin.mjs";
import { credentialSource } from "../remote-cache/credentials.mjs";
import { gateStore } from "../remote-cache/gate.mjs";
import { ci as runCi, ensureServer, report, serverConfig } from "../remote-cache/launch.mjs";
import { signedHeaders } from "../remote-cache/s3.mjs";
import { cacheScope } from "../remote-cache/scope.mjs";
import { createCacheServer, s3Read } from "../remote-cache/server.mjs";
import { setupStep } from "../remote-cache/setup.mjs";

const SETUP = fileURLToPath(new URL("../remote-cache/setup.mjs", import.meta.url));

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
    // Only a push writes main/: a manual run on main gets no cache.
    assert.equal(
      cacheScope({
        env: ci({ GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main" }),
      }),
      null,
    );
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

  /** @scenario "An S3 answer that is neither the object nor a missing key never reads as no taint" */
  it("reads 404 and 403 as a missing object and throws on any other S3 error", async () => {
    const { Readable } = await import("node:stream");
    const answer = (statusCode) => Object.assign(Readable.from([]), { statusCode, headers: {} });
    assert.equal(s3Read(answer(404)), null);
    assert.equal(s3Read(answer(403)), null);
    for (const status of [400, 500, 503])
      assert.throws(() => s3Read(answer(status)), /S3 answered/);
    assert.ok(s3Read(answer(200)).body);
    const scope = cacheScope({
      env: ci({ GITHUB_EVENT_NAME: "pull_request", GITHUB_HEAD_REF: "feat/x" }),
    });
    const store = memoryStore();
    const failing = {
      get: async () => s3Read(answer(503)),
      put: store.put,
    };
    await withServer({ scope, store: failing }, async (port) => {
      await call({ port, method: "PUT", path: "/v1/cache/abc", body: Buffer.from("x") });
    });
    assert.ok(store.objects.has("branch/feat_x/abc"));
    assert.ok(!store.objects.has("pr/abc"));
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

  /** @scenario "Concurrent lookups share one gate call" */
  it("asks the gate once for lookups that arrive together", async () => {
    await withGate(async (gate) => {
      gate.objects.set("pr/1", Buffer.from("one"));
      gate.objects.set("main/2", Buffer.from("two"));
      const store = gateStore({ url: gate.url, token: "member" });
      const scope = cacheScope({ env: {}, localBranch: "feat/x" });
      await withServer({ scope, store }, async (port) => {
        const [one, two] = await Promise.all([
          call({ port, method: "GET", path: "/v1/cache/1" }),
          call({ port, method: "GET", path: "/v1/cache/2" }),
        ]);
        assert.deepEqual([one.body, two.body], ["one", "two"]);
      });
      assert.equal(gate.asked.length, 1);
      assert.equal(gate.asked[0].get.length, 6);

      const many = Array.from({ length: 33 }, (_, i) => `main/many-${i}`);
      await store.prepare(many);
      const after = gate.asked.slice(1);
      assert.deepEqual(
        after.map((ask) => ask.get.length).toSorted((a, b) => a - b),
        [1, 32],
      );
    });
  });

  /** @scenario "A rate-limited gate rests only a few seconds" */
  it("asks the gate again seconds after a 429, not a minute", async () => {
    let calls = 0;
    const server = createServer((req, res) => {
      req.resume();
      calls += 1;
      if (calls === 1) return res.writeHead(429).end("{}");
      return res.writeHead(200).end(JSON.stringify({ expiresIn: 300, get: {}, put: {} }));
    });
    const port = await listen(server);
    let clock = 0;
    const store = gateStore({
      url: `http://127.0.0.1:${port}/gate`,
      token: "member",
      now: () => clock,
    });
    try {
      assert.equal(await store.get("main/1"), null);
      assert.equal(await store.get("main/1"), null);
      assert.equal(calls, 1);
      clock += 6_000;
      assert.equal(await store.get("main/1"), null);
      assert.equal(calls, 2);
    } finally {
      server.close();
    }
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

  /** @scenario "Dev tells a laptop with no GitHub login how to turn the cache on, and never waits" */
  it("tells a person once, tells everyone else each time, and never prompts", () => {
    const base = { env: {}, gate: "https://gate.example", ghInstalled: true, remembered: null };
    assert.deepEqual(setupStep({ ...base, loggedIn: true, interactive: true }), {
      action: "none",
      remember: "on",
    });
    const told = setupStep({ ...base, loggedIn: false, interactive: true });
    assert.equal(told.action, "say");
    assert.match(told.line, /gh auth login/);
    assert.equal(told.remember, "told");
    assert.equal(
      setupStep({ ...base, loggedIn: false, interactive: true, remembered: "told" }).action,
      "none",
    );
    // A machine that was on and lost its login hears it again.
    assert.equal(
      setupStep({ ...base, loggedIn: false, interactive: true, remembered: "on" }).action,
      "say",
    );
    assert.equal(setupStep({ ...base, loggedIn: false, interactive: false }).action, "say");
    assert.equal(setupStep({ ...base, loggedIn: false, interactive: false }).remember, undefined);
    // A person was told once; agents and scripts on the same machine still are, every time.
    assert.equal(
      setupStep({ ...base, loggedIn: false, interactive: false, remembered: "told" }).action,
      "say",
    );
    assert.equal(
      setupStep({ ...base, loggedIn: false, interactive: false, remembered: "no-gh" }).action,
      "say",
    );
    const noGh = setupStep({ ...base, ghInstalled: false, loggedIn: false, interactive: true });
    assert.equal(noGh.remember, "no-gh");
    assert.match(noGh.line, /install the GitHub CLI/);
    assert.equal(
      setupStep({ ...base, gate: "", loggedIn: false, interactive: true }).action,
      "none",
    );
    assert.equal(
      setupStep({ ...base, env: { CI: "1" }, loggedIn: false, interactive: true }).action,
      "none",
    );
  });

  /** @scenario "Dev tells a laptop with no GitHub login how to turn the cache on, and never waits" */
  it("runs the dev check without a terminal and returns at once", () => {
    const home = mkdtempSync(join(tmpdir(), "nx-cache-setup-"));
    const started = Date.now();
    const out = spawnSync(process.execPath, [SETUP], {
      encoding: "utf8",
      input: "",
      timeout: 20_000,
      env: { PATH: "/nonexistent", XDG_CONFIG_HOME: home, HOME: home },
    });
    assert.equal(out.status, 0);
    assert.match(out.stdout, /install the GitHub CLI/);
    assert.ok(Date.now() - started < 10_000);
    rmSync(home, { recursive: true, force: true });
  });

  /** @scenario "CI hands the role's credentials only to the cache server" */
  it("passes only PATH and the role's session to the server and writes the Nx variables", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nx-cache-ci-"));
    const githubEnv = join(dir, "github-env");
    writeFileSync(githubEnv, "");
    const env = ci({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_HEAD_REF: "feat/x",
      GITHUB_ENV: githubEnv,
      PATH: "/usr/bin",
      NX_CACHE_AWS_ACCESS_KEY_ID: "AKIA",
      NX_CACHE_AWS_SECRET_ACCESS_KEY: "secret",
      NX_CACHE_AWS_SESSION_TOKEN: "session",
      NX_CACHE_AWS_CREDENTIAL_EXPIRATION: "2026-11-26T20:00:00Z",
      OPENAI_API_KEY: "job-secret",
    });
    const started = [];
    const logs = [];
    await runCi({
      env,
      workspaceRoot: dir,
      start: async (args) => {
        started.push(args);
        return { port: 4321, token: "tok" };
      },
      log: (line) => logs.push(line),
    });
    assert.equal(started.length, 1);
    assert.deepEqual(started[0].serverEnv, {
      PATH: "/usr/bin",
      AWS_ACCESS_KEY_ID: "AKIA",
      AWS_SECRET_ACCESS_KEY: "secret",
      AWS_SESSION_TOKEN: "session",
      AWS_CREDENTIAL_EXPIRATION: "2026-11-26T20:00:00Z",
    });
    assert.equal(started[0].scope.write, "pr/");
    assert.ok(!Object.keys(env).some((k) => k.startsWith("AWS_")));
    assert.equal(
      readFileSync(githubEnv, "utf8"),
      "NX_SELF_HOSTED_REMOTE_CACHE_SERVER=http://127.0.0.1:4321\nNX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN=tok\n",
    );
    assert.match(logs[0], /writes pr\//);
    // The expiry reaches the server, so its credentials stop five minutes before AWS's.
    const near = credentialSource({
      env: started[0].serverEnv,
      now: () => Date.parse("2026-11-26T19:58:00Z"),
    });
    assert.equal(await near(), null);
    const fresh = credentialSource({
      env: started[0].serverEnv,
      now: () => Date.parse("2026-11-26T18:00:00Z"),
    });
    assert.equal((await fresh()).accessKeyId, "AKIA");
    rmSync(dir, { recursive: true, force: true });
  });

  /** @scenario "No GitHub login leaves Nx on its local cache" */
  it("writes nothing to GITHUB_ENV for an event without a scope or a server that did not start", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nx-cache-ci-"));
    const githubEnv = join(dir, "github-env");
    writeFileSync(githubEnv, "");
    let calls = 0;
    const start = async () => {
      calls++;
      return null;
    };
    const log = () => {};
    await runCi({
      env: ci({ GITHUB_EVENT_NAME: "schedule", GITHUB_ENV: githubEnv }),
      workspaceRoot: dir,
      start,
      log,
    });
    assert.equal(calls, 0);
    await runCi({
      env: ci({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main", GITHUB_ENV: githubEnv }),
      workspaceRoot: dir,
      start,
      log,
    });
    assert.equal(calls, 1);
    assert.equal(readFileSync(githubEnv, "utf8"), "");
    rmSync(dir, { recursive: true, force: true });
  });

  /** @scenario "A worktree keeps one cache server per configuration" */
  it("derives one key and state file per scope, bucket and token, and reads its settings from the environment", () => {
    const scope = cacheScope({ env: {}, localBranch: "feat/x" });
    const base = { workspaceRoot: "/w", scope, gate: "https://gate.example", env: {} };
    const a = serverConfig({ ...base, githubToken: "gho_a" });
    assert.equal(serverConfig({ ...base, githubToken: "gho_a" }).key, a.key);
    assert.notEqual(serverConfig({ ...base, githubToken: "gho_b" }).key, a.key);
    assert.notEqual(
      serverConfig({
        ...base,
        githubToken: "gho_a",
        scope: cacheScope({ env: {}, localBranch: "feat/y" }),
      }).key,
      a.key,
    );
    assert.notEqual(
      serverConfig({
        ...base,
        githubToken: "gho_a",
        env: { LANGWATCH_NX_REMOTE_CACHE_BUCKET: "other" },
      }).key,
      a.key,
    );
    assert.equal(a.stateFile, `/w/.nx/remote-cache/server-${a.key.slice(0, 16)}.json`);
    assert.equal(a.logFile, "/w/.nx/remote-cache/server.log");
    assert.equal(a.bucket, "langwatch-dev-nx-remote-cache");
    assert.equal(a.region, "eu-central-1");
    assert.equal(a.maxUploadBytes, 200 * 1024 * 1024);
    assert.ok(!JSON.stringify(a).includes("gho_a"));
    const custom = serverConfig({
      ...base,
      env: { LANGWATCH_NX_REMOTE_CACHE_REGION: "eu-west-1", LANGWATCH_NX_REMOTE_CACHE_MAX_MB: "5" },
    });
    assert.equal(custom.region, "eu-west-1");
    assert.equal(custom.maxUploadBytes, 5 * 1024 * 1024);
    assert.notEqual(custom.token, a.token);
  });

  /** @scenario "A worktree keeps one cache server per configuration" */
  it("reuses a running server, replaces a stale one, and never signals a pid that is not its server", async () => {
    const root = mkdtempSync(join(tmpdir(), "nx-cache-launch-"));
    const scope = cacheScope({ env: {}, localBranch: "feat/x" });
    const args = { workspaceRoot: root, scope, env: {}, serverEnv: { PATH: process.env.PATH } };
    const bystander = spawn("sleep", ["60"], { stdio: "ignore" });
    const stranger = createServer((_req, res) => res.writeHead(200).end("ok"));
    const strangerPort = await listen(stranger);
    const pids = [];
    try {
      const first = await ensureServer(args);
      assert.ok(first);
      pids.push(first.pid);
      const again = await ensureServer(args);
      assert.equal(again.pid, first.pid);
      assert.equal(again.port, first.port);

      // A state file left from a reboot: its pid now belongs to another process and its
      // port to another server. Neither is touched; a new server takes over.
      const { stateFile } = serverConfig(args);
      process.kill(first.pid);
      await new Promise((r) => setTimeout(r, 200));
      writeFileSync(
        stateFile,
        JSON.stringify({ ...first, pid: bystander.pid, port: strangerPort }),
      );
      const replaced = await ensureServer(args);
      assert.ok(replaced);
      pids.push(replaced.pid);
      assert.notEqual(replaced.pid, bystander.pid);
      assert.doesNotThrow(() => process.kill(bystander.pid, 0));
      const health = await (await fetch(`http://127.0.0.1:${replaced.port}/health`)).json();
      assert.deepEqual(health, { pid: replaced.pid, key: serverConfig(args).key });
    } finally {
      for (const pid of pids) {
        try {
          process.kill(pid);
        } catch {
          // Already gone.
        }
      }
      bystander.kill();
      stranger.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** @scenario "A cache server that does not start leaves Nx on its local cache" */
  it("gives up on a server that never answers and stops the process it started", async () => {
    const root = mkdtempSync(join(tmpdir(), "nx-cache-launch-"));
    const script = join(root, "silent.mjs");
    writeFileSync(script, "setInterval(() => {}, 1000);\n");
    const state = await ensureServer({
      workspaceRoot: root,
      scope: cacheScope({ env: {}, localBranch: "feat/x" }),
      env: {},
      serverEnv: { PATH: process.env.PATH },
      serverPath: script,
      startupPolls: 3,
    });
    assert.equal(state, null);
    rmSync(root, { recursive: true, force: true });
  });

  /** @scenario "CI shows what the cache server saw" */
  it("prints the server log and warns once when requests failed", () => {
    const quiet = report("2026-11-26T00:00:00Z listening on 1234 for pr, writing pr/\n");
    assert.deepEqual(quiet, ["2026-11-26T00:00:00Z listening on 1234 for pr, writing pr/"]);
    const failed = report(
      [
        "2026-11-26T00:00:00Z listening on 1234 for pr, writing pr/",
        "2026-11-26T00:00:01Z get pr/abc: socket hang up",
        "2026-11-26T00:00:02Z put pr/abc: S3 answered 403",
        "",
      ].join("\n"),
    );
    assert.equal(failed.length, 4);
    assert.match(failed[3], /^::warning title=Nx remote cache::2 cache request/);
  });
});
