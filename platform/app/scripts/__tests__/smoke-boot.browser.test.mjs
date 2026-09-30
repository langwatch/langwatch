import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../smoke-boot.mjs", import.meta.url));

/**
 * @param {Record<string, string>} chunks
 * @param {boolean} [mount]
 */
async function smoke(chunks, mount = true) {
  const assets = await mkdtemp(join(tmpdir(), "smoke-boot-"));
  const server = createServer((request, response) => {
    const chunk = chunks[request.url?.replace("/assets/", "") ?? ""];
    response.setHeader(
      "Content-Type",
      chunk === void 0 ? "text/html" : "text/javascript",
    );
    response.end(
      chunk ?? `<div id="root">${mount ? "Mounted ".repeat(20) : ""}</div>`,
    );
  });

  try {
    await Promise.all(
      Object.keys(chunks).map((name) => writeFile(join(assets, name), "")),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Smoke fixture did not bind its TCP port");
    }
    const child = spawn(process.execPath, [script], {
      env: {
        ...process.env,
        SMOKE_URL: `http://127.0.0.1:${address.port}`,
        SMOKE_ASSETS_DIR: assets,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (data) => (output += data));
    child.stderr.setEncoding("utf8").on("data", (data) => (output += data));
    const deadline = setTimeout(() => child.kill("SIGKILL"), 70_000);
    try {
      const [code, signal] = await once(child, "close");
      if (signal !== null) throw new Error(`Smoke fixture killed: ${output}`);
      return { code, output };
    } finally {
      clearTimeout(deadline);
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(assets, { recursive: true, force: true });
  }
}

test("mounts and evaluates every emitted chunk", async () => {
  const result = await smoke({
    "a.js": "export const ready = true;",
    ...Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [
        `b${index}.js`,
        "import { ready } from './a.js'; if (!ready) throw Error('bad');",
      ]),
    ),
  });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /BOOT SMOKE PASSED.*chunks scanned: 34/);
});

test("fails when a lazy chunk has an uninitialized binding", async () => {
  const result = await smoke({
    "a.js": "export {};",
    "lazy.js": "missingBinding();",
  });
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /lazy\.js: missingBinding is not defined/);
});

for (const { name, source } of [
  {
    name: "unresolved top-level await",
    source: "await new Promise(() => {});",
  },
  { name: "blocked renderer", source: "while (true) {}" },
]) {
  test(`fails promptly for ${name} without claiming a complete scan`, async () => {
    const result = await smoke({
      "a.js": source,
      ...Object.fromEntries(
        Array.from({ length: 33 }, (_, index) => [
          `z${index}.js`,
          "export {};",
        ]),
      ),
    });
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /chunk imports timed out: a\.js/);
    assert.doesNotMatch(result.output, /Importing chunks 33|BOOT SMOKE PASSED/);
  });
}

test("fails when the application never mounts", async () => {
  const result = await smoke({ "a.js": "export {};" }, false);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /app did not mount within timeout/);
  assert.doesNotMatch(result.output, /BOOT SMOKE PASSED/);
});
