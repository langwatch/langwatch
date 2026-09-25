// Written into a branch worktree's packages/api by apidiff and deleted after
// it runs: imports every contract that calls defineTrpcContract and prints the
// built declarations as a procedure manifest. A declaration a contract cannot
// hold (authz: @langwatch/api depends on its contract) is read from the
// process transport, after every contract.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

const [outFile, repoRoot] = process.argv.slice(2);

function listDir(dir, options) {
  try {
    return readdirSync(dir, options);
  } catch {
    return [];
  }
}

function moduleContractFiles(contractDir) {
  return listDir(contractDir, { recursive: true })
    .map((entry) => join(contractDir, String(entry)))
    .filter((file) => file.endsWith(".ts") && !file.includes("__tests__"))
    .filter((file) => readFileSync(file, "utf8").includes("defineTrpcContract("));
}

function contractFiles() {
  const files = [];
  for (const parent of ["modules", "enterprise/modules"]) {
    for (const module of listDir(join(repoRoot, parent))) {
      files.push(...moduleContractFiles(join(repoRoot, parent, module, "contract/src")));
    }
  }
  const transports = [];
  for (const parent of ["modules", "enterprise/modules"]) {
    for (const module of listDir(join(repoRoot, parent))) {
      transports.push(...moduleContractFiles(join(repoRoot, parent, module, "process/src/transport")));
    }
  }
  const byPath = (left, right) => left.localeCompare(right);
  return [...files.toSorted(byPath), ...transports.toSorted(byPath)];
}

function toJsonSchema(schema, io) {
  if (!schema || typeof schema !== "object") return null;
  try {
    return z.toJSONSchema(schema, { io, unrepresentable: "any", cycles: "ref", reused: "inline" });
  } catch (error) {
    return { unconverted: String(error && error.message) };
  }
}

function isContract(value) {
  return (
    value &&
    typeof value.namespace === "string" &&
    value.members &&
    typeof value.members === "object"
  );
}

const procedures = new Map();
const failures = [];
for (const file of contractFiles()) {
  let exported;
  try {
    exported = await import(pathToFileURL(file).href);
  } catch (error) {
    failures.push({ source: relative(repoRoot, file), error: String(error && error.message) });
    continue;
  }
  for (const value of Object.values(exported)) {
    if (!isContract(value)) continue;
    for (const [name, member] of Object.entries(value.members)) {
      const path = `${value.namespace}.${name}`;
      if (procedures.has(path)) continue;
      procedures.set(path, {
        path,
        kind: member.kind,
        input: toJsonSchema(member.input, "input"),
        output: member.output ? toJsonSchema(member.output, "output") : null,
        source: relative(repoRoot, file),
      });
    }
  }
}
const sorted = [...procedures.values()].toSorted((left, right) =>
  left.path.localeCompare(right.path),
);
writeFileSync(outFile, JSON.stringify({ side: "branch", procedures: sorted, failures }, null, 2));
process.exit(0);
