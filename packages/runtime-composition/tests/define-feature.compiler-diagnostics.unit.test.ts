import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const installer = resolve(root, "src/feature-installer.ts");
const application = resolve(root, "src/application.ts");
const tsc = resolve(root, "node_modules/.bin/tsc");
type Diagnostic = { line: number; code: string; text: string };

function diagnosticsFor(source: string): Diagnostic[] {
  const directory = mkdtempSync(join(tmpdir(), "runtime-composition-types-"));
  const file = join(directory, "fixture.ts");
  const config = join(directory, "tsconfig.json");
  writeFileSync(
    file,
    source.replaceAll("__INSTALLER__", installer).replaceAll("__APPLICATION__", application),
  );
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
  try {
    execFileSync(tsc, ["--project", config, "--pretty", "false"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return [];
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string };
    return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.split("\n").flatMap((line) => {
      const match = line.match(/fixture\.ts\((\d+),\d+\): error (TS\d+): (.*)$/);
      const [, lineNumber, code, text] = match ?? [];
      return lineNumber !== undefined && code !== undefined && text !== undefined
        ? [{ line: Number(lineNumber), code, text }]
        : [];
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("defineFeature compiler diagnostics", () => {
  it("accepts a valid declaration and matching root", () => {
    const diagnostics = diagnosticsFor(`
      import { createApp } from "__APPLICATION__";
      import { defineFeature, type FeatureSetup } from "__INSTALLER__";
      abstract class Contract { abstract readonly value: string; }
      class App extends Contract {
        static readonly contract = Contract;
        static readonly dependencies = {};
        readonly value = "ok";
        static create(setup: FeatureSetup<{}, {}, undefined>): App { return new App(); }
      }
      const feature = defineFeature("annotation").withApp(App).build();
      createApp({ name: "test" }).withInfrastructure({}).withFeature(feature);
    `);
    expect(diagnostics).toEqual([]);
  });

  const cases = [
    [
      "rejects a root without required infrastructure",
      "TS2345",
      `
      import { createApp } from "__APPLICATION__";
      import { defineFeature, type FeatureSetup } from "__INSTALLER__";
      abstract class Contract { abstract readonly value: string; }
      class App extends Contract { static readonly contract = Contract; static readonly dependencies = {}; readonly value: string; constructor(value: string) { super(); this.value = value; } static create(setup: FeatureSetup<{}, { suffix: string }, undefined>): App { return new App(setup.infrastructure.suffix); } }
      const feature = defineFeature("annotation").withApp(App).build();
      createApp({ name: "test" }).withInfrastructure({}).withFeature(feature); // EXPECT
    `,
    ],
    [
      "rejects the explicit infrastructure bypass with a wrong root",
      "TS2345",
      `
      import { createApp } from "__APPLICATION__";
      import { defineFeature, type FeatureSetup } from "__INSTALLER__";
      abstract class Contract { abstract readonly value: string; }
      class App extends Contract { static readonly contract = Contract; static readonly dependencies = {}; readonly value: string; constructor(value: string) { super(); this.value = value; } static create(setup: FeatureSetup<{}, { suffix: string }, undefined>): App { return new App(setup.infrastructure.suffix); } }
      const feature = defineFeature("annotation").withApp(App).build();
      createApp({ name: "test" }).withInfrastructure({}).withFeature<{}>(feature, { infrastructure: {} }); // EXPECT
    `,
    ],
    [
      "rejects an undeclared dependency",
      "TS2339",
      `
      import { defineFeature, type FeatureSetup } from "__INSTALLER__";
      abstract class Contract { abstract readonly value: string; }
      class App extends Contract { static readonly contract = Contract; static readonly dependencies = {}; readonly value = "ok"; static create(setup: FeatureSetup<{}, undefined, undefined>): App { setup.dependencies.missing; return new App(); } } // EXPECT
      defineFeature("annotation").withApp(App).build();
    `,
    ],
    [
      "rejects a dependency map that disagrees with the factory",
      "TS2769",
      `
      import { defineFeature, type FeatureSetup } from "__INSTALLER__";
      abstract class Contract { abstract readonly value: string; }
      abstract class Peer { abstract readonly value: string; }
      class App extends Contract { static readonly contract = Contract; static readonly dependencies = { peer: Peer }; readonly value = "ok"; static create(setup: FeatureSetup<{ other: typeof Peer }, undefined, undefined>): App { return new App(); } }
      defineFeature("annotation").withApp(App).build(); // EXPECT
    `,
    ],
    [
      "requires a config schema for typed config",
      "TS2769",
      `
      import { defineFeature, type FeatureSetup } from "__INSTALLER__";
      abstract class Contract { abstract readonly value: string; }
      class App extends Contract { static readonly contract = Contract; static readonly dependencies = {}; readonly value = "ok"; static create(setup: FeatureSetup<{}, undefined, { required: string }>): App { return new App(); } }
      defineFeature("annotation").withApp(App).build(); // EXPECT
    `,
    ],
    [
      "rejects a schema that disagrees with the factory config",
      "TS2769",
      `
      import { defineFeature, type FeatureSetup } from "__INSTALLER__";
      abstract class Contract { abstract readonly value: string; }
      class App extends Contract { static readonly contract = Contract; static readonly dependencies = {}; static readonly configSchema = { parse: (value: unknown): { other: number } => ({ other: 1 }) }; readonly value = "ok"; static create(setup: FeatureSetup<{}, undefined, { required: string }>): App { return new App(); } }
      defineFeature("annotation").withApp(App).build(); // EXPECT
    `,
    ],
    [
      "rejects an app result incompatible with its contract",
      "TS2769",
      `
      import { defineFeature } from "__INSTALLER__";
      abstract class Contract { abstract readonly value: string; }
      class App { static readonly contract = Contract; static readonly dependencies = {}; static create(): { wrong: boolean } { return { wrong: true }; } }
      defineFeature("annotation").withApp(App).build(); // EXPECT
    `,
    ],
  ] as const;

  it.each(cases)("%s", (_name, code, source) => {
    const expectedLine = source.split("\n").findIndex((line) => line.includes("// EXPECT")) + 1;
    const diagnostics = diagnosticsFor(source);
    expect(
      diagnostics.map(({ line, code: diagnosticCode }) => ({ line, code: diagnosticCode })),
    ).toEqual([{ line: expectedLine, code }]);
  });
});
