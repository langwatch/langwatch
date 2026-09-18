import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const scaledModules = Array.from({ length: 49 }, (_, index) => {
  const name = `m${String(index).padStart(2, "0")}`;
  let module = "clockModule";
  if (index % 3 === 0) module = "configModule";
  else if (index % 5 === 0) module = "peerModule";
  return `{ ...${module}, name: "${name}" }`;
}).join(", ");
const scaledConfigEntries = Array.from({ length: 49 }, (_, index) => index)
  .filter((index) => index % 3 === 0)
  .map((index) => `"m${String(index).padStart(2, "0")}": { pepper: "test" }`);
const scaledConfig = `{ ${scaledConfigEntries.join(", ")} }`;
const scaledConfigWithoutLast = `{ ${scaledConfigEntries.slice(0, -1).join(", ")} }`;
const truncationStatements = Object.fromEntries(
  Array.from({ length: 20 }, (_, index) => {
    const count = index + 1;
    const modules = Array.from({ length: count }, (__, moduleIndex) => {
      const name = `t${String(moduleIndex).padStart(2, "0")}`;
      return `{ ...configModule, name: "${name}" }`;
    }).join(", ");
    return [
      `missing${String(count).padStart(2, "0")}`,
      `createApp({ role: "api" }).withModules([${modules}]).boot();`,
    ];
  }),
);
const statements = {
  scale: `createApp({ role: "api" }).withModules([${scaledModules}]).withConfig(${scaledConfig}).provide({ project }).boot();`,
  scaleConfig: `createApp({ role: "api" }).withModules([${scaledModules}]).withConfig(${scaledConfigWithoutLast}).withClock(clock).provide({ project }).boot();`,
  scalePeer: `createApp({ role: "api" }).withModules([${scaledModules}]).withConfig(${scaledConfig}).withClock(clock).boot();`,
  scaleAll: `createApp({ role: "api" }).withModules([${scaledModules}]).boot();`,
  member: 'createApp({ role: "api" }).withModules([clockModule]).boot();',
  memberType: 'createApp({ role: "api" }).withModules([clockModule]).withClock(42);',
  customMissing: 'createApp({ role: "api" }).withModules([connectionsModule]).boot();',
  customType:
    'createApp({ role: "api" }).withModules([connectionsModule]).withMember("connections", { primary: () => 42 });',
  customUndeclared:
    'createApp({ role: "api" }).withModules([connectionsModule]).withMember("connection", connections);',
  customBeforeModules: 'createApp({ role: "api" }).withMember("connections", connections);',
  config: 'createApp({ role: "api" }).withModules([configModule]).boot();',
  configSlice: 'createApp({ role: "api" }).withModules([configModule]).withConfig({});',
  configType:
    'createApp({ role: "api" }).withModules([configModule]).withConfig({ "api-key": { pepper: 42 } });',
  configTypo:
    'createApp({ role: "api" }).withModules([configModule]).withConfig({ "api-key": { peper: "test" } });',
  peer: 'createApp({ role: "api" }).withModules([peerModule]).boot();',
  supplyTokenMissing: 'createApp({ role: "api" }).withModules([licenseConsumerModule]).boot();',
  supplyTokenType:
    'createApp({ role: "api" }).withModules([licenseConsumerModule]).provide({ licenseSource: { resolve: () => 42 } });',
  peerType:
    'createApp({ role: "api" }).withModules([peerModule]).provide({ project: { other: () => "wrong" } });',
  peerEarlier:
    'createApp({ role: "api" }).provide({ project: { other: () => "wrong" } }).withModules([peerModule]).boot();',
  widened:
    'const ready: ProcessSupply = createApp({ role: "api" }).withModules([clockModule, configModule, peerModule]); ready.boot();',
  constructed:
    'new ProcessSupply({ role: "api", modules: [clockModule], members: {}, config: {}, peers: {} }).boot();',
  assigned:
    'Object.assign(createApp({ role: "api" }).withModules([clockModule]), { clock }).boot();',
  leakedProof:
    'const proofDoesNotLeak = createApp({ role: "api" }).withModules([clockModule]); proofDoesNotLeak.__missing;',
  spreadClone:
    '({ ...createApp({ role: "api" }).withModules([clockModule]).withClock(clock) }).boot();',
  runtimeTestedBoot:
    'const runtimeTestedBoot = createApp({ role: "api" }).withModules([clockModule]); if (runtimeTestedBoot.boot instanceof Function) runtimeTestedBoot.boot();',
  startDependencies: "supplyEntry.startDependencies(peerModule);",
  startMembers: "supplyEntry.startMembers(clockModule);",
  startRepositories: "supplyEntry.startRepositories(repositoryModule);",
  startConfiguration: "supplyEntry.startConfiguration(configModule);",
  structural:
    'function startStructurally(builder: { boot(): Promise<unknown> }) { return builder.boot(); } startStructurally(createApp({ role: "api" }).withModules([clockModule]));',
  callableIntersection:
    'const incompleteForIntersection = createApp({ role: "api" }).withModules([clockModule]); const callable: typeof incompleteForIntersection & { boot(): Promise<unknown> } = incompleteForIntersection; callable.boot();',
  widenedModulesExplicit: 'createApp({ role: "api" }).withModules<SupplyModule[]>([clockModule]);',
  widenedModulesVariable:
    'const widenedModules: readonly SupplyModule[] = [clockModule]; createApp({ role: "api" }).withModules(widenedModules);',
  widenedModulesParameter:
    'function installWidened(modules: readonly SupplyModule[]) { return createApp({ role: "api" }).withModules(modules); }',
  widenedModuleParameter:
    'function installWidenedModule(module: SupplyModule) { return createApp({ role: "api" }).withModules([module]); }',
  namedWidenedModuleParameter:
    'function installNamedWidenedModule(module: SupplyModule & { readonly name: "annotation"; readonly unrelated: true }) { return createApp({ role: "api" }).withModules([module]).withConfig({ annotation: {} }).boot(); }',
  nameEvidenceErased:
    'function installNameEvidenceErased(module: Omit<typeof clockModule, "name"> & { readonly name: string }) { return createApp({ role: "api" }).withModules([module]); }',
  broadSchema:
    'function installBroadSchema(module: Omit<typeof clockModule, "configSchema"> & Pick<SupplyModule, "configSchema">) { return createApp({ role: "api" }).withModules([module]); }',
  membersEvidenceErased:
    'function installMembersEvidenceErased(module: Omit<typeof clockModule, "members">) { return createApp({ role: "api" }).withModules([module]); }',
  unionArray:
    'const unionArray: (typeof peerModule | typeof projectModule)[] = [peerModule]; createApp({ role: "api" }).withModules(unionArray);',
  unionTuples:
    'function modulesFromBranch(include: boolean): readonly [typeof peerModule, typeof projectModule] | readonly [typeof peerModule] { return include ? [peerModule, projectModule] : [peerModule]; } createApp({ role: "api" }).withModules(modulesFromBranch(false)).boot();',
  indexedPeer:
    'const peers: Record<string, ProjectApi> = {}; createApp({ role: "api" }).withModules([peerModule]).provide(peers).boot();',
  indexedConfig:
    'const config: Record<string, { pepper: string }> = {}; createApp({ role: "api" }).withConfig(config).withModules([configModule]).boot();',
  duplicateBefore:
    'createApp({ role: "api" }).provide({ project }).withModules([peerModule, projectModule]).boot();',
  duplicateAfter:
    'createApp({ role: "api" }).withModules([peerModule, projectModule]).provide({ project }).boot();',
  overwritten:
    'createApp({ role: "api" }).withClock(clock).withClock(42).withModules([clockModule]).boot();',
  all: 'createApp({ role: "api" }).withModules([clockModule, configModule, facilityModule, peerModule]).boot();',
  callback:
    'createApp({ role: "api" }).withModules([clockModule]).withObservability((o) => o.withMetrics(facilities.metrics)).boot();',
  bootArgs: 'createApp({ role: "api" }).boot({});',
  surfaceWithoutServe: 'createApp({ role: "api" }).expose(() => ({ hosts: {} }));',
  surfaceWithoutHosts: 'createApp({ role: "api" }).expose(() => ({ serve: () => void 0 }));',
  badService:
    'createApp({ role: "worker" }).withService({ name: "producer", start: () => void 0 });',
  goodClock: 'createApp({ role: "api" }).withModules([clockModule]).withClock(clock).boot();',
  goodCustom:
    'createApp({ role: "api" }).withModules([connectionsModule]).withMember("connections", connections).boot();',
  goodMemory:
    'createApp({ role: "api" }).withModules([memoryRepositoryModule]).withClock(clock).boot();',
  goodPeer: 'createApp({ role: "api" }).withModules([peerModule]).provide({ project }).boot();',
  goodSupplyToken:
    'createApp({ role: "api" }).withModules([licenseConsumerModule]).provide({ licenseSource }).boot();',
  installedLater:
    'createApp({ role: "api" }).withModules([peerModule]).withModules([projectModule]).boot();',
  noModules: 'createApp({ role: "worker" }).boot();',
  noAnalytics: 'createApp({ role: "worker" }).withModules([projectModule]).boot();',
  goodConfig:
    'createApp({ role: "api" }).withModules([configModule]).withConfig({ "api-key": { pepper: "test" } }).boot();',
  doorsClosed: 'createApp({ role: "worker" }).withModules([projectModule]).boot();',
  surfaceEmpty:
    'createApp({ role: "api" }).expose(() => ({ hosts: {}, serve: () => void 0 })).boot();',
  surfaceOpened:
    'createApp({ role: "api" }).expose(() => ({ hosts: { rest: { mount: () => ({}) } }, serve: () => void 0 })).boot();',
  goodService:
    'createApp({ role: "worker" }).withService({ name: "producer", start: () => void 0, stop: () => void 0 }).boot();',
  ...truncationStatements,
};
let diagnostics: ReadonlyMap<string, string[]>;

beforeAll(() => {
  const directory = mkdtempSync(join(tmpdir(), "process-supply-types-"));
  const file = join(directory, "fixture.ts");
  const config = join(directory, "tsconfig.json");
  const imports = [
    `import { createApp, ProcessSupply } from ${JSON.stringify(resolve(root, "src/process-supply.ts"))};`,
    `import * as supplyEntry from ${JSON.stringify(resolve(root, "src/process-supply.ts"))};`,
    `import type { SupplyModule } from ${JSON.stringify(resolve(root, "src/process-supply.types.ts"))};`,
    `import { clock, clockModule, connections, connectionsModule, configModule, facilities, facilityModule, licenseConsumerModule, licenseSource, memoryRepositoryModule, peerModule, project, projectModule, repositoryModule, type ProjectApi } from ${JSON.stringify(resolve(root, "tests/process-supply.fixtures.ts"))};`,
  ];
  const entries = Object.entries(statements);
  writeFileSync(file, [...imports, ...entries.map(([, source]) => source)].join("\n"));
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        allowImportingTsExtensions: true,
        module: "ESNext",
        moduleResolution: "Bundler",
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: "ES2022",
      },
      files: [file],
    }),
  );
  let output = "";
  try {
    execFileSync(
      resolve(root, "node_modules/.bin/tsc"),
      ["--project", config, "--pretty", "false"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    if (!(error instanceof Error) || !("stdout" in error) || typeof error.stdout !== "string")
      throw error;
    output = error.stdout;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  const result = new Map<string, string[]>();
  let current: string | undefined;
  for (const line of output.split("\n")) {
    const match = line.match(/fixture\.ts\((\d+),\d+\): error TS\d+: (.*)/);
    if (match) {
      current = entries[Number(match[1]) - imports.length - 1]?.[0];
      if (!current) throw new Error(`Unexpected compiler error: ${line}`);
      result.set(current, [...(result.get(current) ?? []), line]);
    } else if (line.includes("error TS")) {
      throw new Error(`Compiler failed outside fixture: ${line}`);
    } else if (current && line.trim()) {
      result.set(current, [...(result.get(current) ?? []), line]);
    }
  }
  diagnostics = result;
}, 30_000);

describe("compiler checked process supply", () => {
  it.each([
    "member",
    "memberType",
    "customMissing",
    "customType",
    "customUndeclared",
    "customBeforeModules",
    "configSlice",
    "configType",
    "peer",
    "supplyTokenMissing",
    "supplyTokenType",
    "peerType",
    "peerEarlier",
    "widened",
    "constructed",
    "assigned",
    "leakedProof",
    "spreadClone",
    "runtimeTestedBoot",
    "startDependencies",
    "startMembers",
    "startRepositories",
    "startConfiguration",
    "structural",
    "callableIntersection",
    "widenedModulesExplicit",
    "widenedModulesVariable",
    "widenedModulesParameter",
    "widenedModuleParameter",
    "namedWidenedModuleParameter",
    "nameEvidenceErased",
    "broadSchema",
    "membersEvidenceErased",
    "unionArray",
    "unionTuples",
    "indexedPeer",
    "indexedConfig",
    "duplicateBefore",
    "duplicateAfter",
    "overwritten",
    "callback",
    "bootArgs",
    "surfaceWithoutServe",
    "surfaceWithoutHosts",
    "badService",
  ])("refuses %s", (name) => {
    expect(diagnostics.get(name)?.length).toBeGreaterThan(0);
  });

  /** @scenario "Supplying nothing names everything missing at once" */
  it("names the whole missing supply in one refusal", () => {
    const refusal = diagnostics.get("all")?.join("\n");
    const outstanding = refusal?.match(/MissingSupply<([^']+)>/)?.[1];
    for (const name of [
      "relational",
      "keyvalue",
      "clock",
      "logging",
      "metrics",
      "tracing",
      "secrets",
      "encryption",
      "config.api-key",
      "peer.project",
    ]) {
      expect(outstanding).toContain(name);
    }
    expect(outstanding).not.toContain("more");
  });

  /** @scenario "Installing a module with configuration makes configuration required" */
  it("names the installed module whose config was omitted", () => {
    expect(diagnostics.get("config")?.join("\n")).toContain("config.api-key");
    expect(diagnostics.get("configSlice")?.join("\n")).toContain('"api-key"');
  });

  it("names declared custom members and external supplies", () => {
    expect(diagnostics.get("customMissing")?.join("\n")).toContain('MissingSupply<"connections">');
    expect(diagnostics.get("supplyTokenMissing")?.join("\n")).toContain(
      'MissingSupply<"peer.licenseSource">',
    );
  });

  it("refuses a misspelled required field", () => {
    expect(diagnostics.get("configTypo")?.join("\n")).toContain("pepper");
  });

  it("keeps config slices, members and peer gaps at 49 modules", () => {
    expect(diagnostics.get("scale")?.join("\n")).toContain('MissingSupply<"clock">');
    expect(diagnostics.get("scaleConfig")?.join("\n")).toContain("m48");
    expect(diagnostics.get("scalePeer")?.join("\n")).toContain('MissingSupply<"peer.project">');
  });

  it("records the default diagnostic truncation boundary", () => {
    const measured = Array.from({ length: 20 }, (_, index) => {
      const count = index + 1;
      const name = `missing${String(count).padStart(2, "0")}`;
      const refusal = diagnostics.get(name)?.join("\n");
      const outstanding = refusal?.match(/MissingSupply<([^']+)>/)?.[1];
      return { count, truncated: outstanding?.includes("more") ?? true };
    });
    expect(measured.filter(({ truncated }) => !truncated).at(-1)?.count).toBe(15);
    expect(measured.find(({ truncated }) => truncated)?.count).toBe(16);
  });

  it("shows the real-scale all-missing diagnostic is truncated", () => {
    const refusal = diagnostics.get("scaleAll")?.join("\n");
    const outstanding = refusal?.match(/MissingSupply<([^']+)>/)?.[1];
    expect(outstanding).toContain("more");
  });

  it.each([
    "goodClock",
    "goodCustom",
    "goodMemory",
    "goodPeer",
    "goodSupplyToken",
    "installedLater",
    "noModules",
    "noAnalytics",
    "goodConfig",
    "doorsClosed",
    "surfaceEmpty",
    "surfaceOpened",
    "goodService",
  ])("accepts %s", (name) => {
    expect(diagnostics.get(name)).toBeUndefined();
  });
});
