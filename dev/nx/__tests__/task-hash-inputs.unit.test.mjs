// The task inputs in nx.json that a laptop and CI must agree on,
// bound to specs/ci/nx-remote-cache.feature.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const nx = JSON.parse(readFileSync(new URL("../../../nx.json", import.meta.url), "utf8"));
const DATASTORES = [
  "LANGWATCH_TEST_DATABASE_URL",
  "LANGWATCH_TEST_REDIS_URL",
  "LANGWATCH_TEST_CLICKHOUSE_URL",
];

const runtimeOf = (name) => nx.namedInputs[name][0].runtime;
const run = (command, extra) => {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !DATASTORES.includes(key)),
  );
  return spawnSync("sh", ["-c", command], { env: { ...base, ...extra }, encoding: "utf8" }).stdout;
};

const everyInput = (value) => {
  if (Array.isArray(value)) return value.flatMap(everyInput);
  if (!value || typeof value !== "object") return [];
  return [value, ...Object.values(value).flatMap(everyInput)];
};

describe("task hash inputs", () => {
  /** @scenario "A laptop and CI hash a task alike" */
  it("hashes whether each test datastore is set, never its address", () => {
    const command = runtimeOf("testDatastores");
    const ci = Object.fromEntries(DATASTORES.map((name) => [name, `ci://${name}`]));
    const laptop = Object.fromEntries(DATASTORES.map((name) => [name, `laptop://${name}/5`]));
    assert.equal(run(command, ci), run(command, laptop));
    assert.notEqual(run(command, ci), run(command, { ...ci, LANGWATCH_TEST_REDIS_URL: "" }));
    assert.doesNotMatch(run(command, ci), /ci:\/\//);
  });

  it("hashes the Node.js major version, not the patch release", () => {
    assert.equal(run(runtimeOf("nodeMajor"), {}).trim(), process.versions.node.split(".")[0]);
  });

  it("leaves no task hashing the full Node.js version or a datastore address", () => {
    const inputs = everyInput([nx.namedInputs, nx.targetDefaults]);
    assert.deepEqual(
      inputs.filter(
        (input) => input.runtime === "node --version" || DATASTORES.includes(input.env),
      ),
      [],
    );
  });
});
