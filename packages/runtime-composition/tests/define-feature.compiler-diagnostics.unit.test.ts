import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const installer = resolve(root, "src/feature-installer.ts");
const application = resolve(root, "src/application.ts");
const contract = resolve(root, "src/module-api-token.ts");
const repositoryRegistry = resolve(root, "src/repository-registry.ts");
const memberSource = resolve(root, "tests/member-source.ts");
const tsc = resolve(root, "node_modules/.bin/tsc");
type Diagnostic = { line: number; code: string; text: string };

function diagnosticsFor(source: string): Diagnostic[] {
  const directory = mkdtempSync(join(tmpdir(), "runtime-composition-types-"));
  const file = join(directory, "fixture.ts");
  const config = join(directory, "tsconfig.json");
  writeFileSync(
    file,
    source
      .replaceAll("__INSTALLER__", installer)
      .replaceAll("__APPLICATION__", application)
      .replaceAll("__CONTRACT__", contract)
      .replaceAll("__REPOSITORY_REGISTRY__", repositoryRegistry)
      .replaceAll("__MEMBERS__", memberSource),
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
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const diagnostics = output.split("\n").flatMap((line) => {
      const match = line.match(/fixture\.ts\((\d+),\d+\): error (TS\d+): (.*)$/);
      const [, lineNumber, code, text] = match ?? [];
      return lineNumber !== undefined && code !== undefined && text !== undefined
        ? [{ line: Number(lineNumber), code, text }]
        : [];
    });
    const hasExternalError = output.split("\n").some((line) => {
      return line.includes("error TS") && !line.includes("fixture.ts(");
    });
    const failedOutsideFixture = diagnostics.length === 0 || hasExternalError;
    if (failedOutsideFixture) {
      throw new Error(`Fixture compiler failed outside the expected source: ${output}`, {
        cause: error,
      });
    }
    return diagnostics;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("defineModule compiler diagnostics", () => {
  it("accepts a valid declaration and matching root", () => {
    const diagnostics = diagnosticsFor(`
      import { createApp } from "__APPLICATION__";
      import { memberSourceOf } from "__MEMBERS__";
      import { defineModule, type FeatureSetup } from "__INSTALLER__";
      abstract class Contract { abstract readonly value: string; }
      class App extends Contract {
        static readonly contract = Contract;
        static readonly dependencies = {};
        readonly value = "ok";
        static create(setup: FeatureSetup<{}, {}, undefined>): App { return new App(); }
      }
      const feature = defineModule("annotation").withApp(App).build();
      createApp({ role: "api", members: memberSourceOf({}) })
        .withModules([feature]);
    `);
    expect(diagnostics).toEqual([]);
  });

  it("accepts inferred peer APIs and an implementation with private state", () => {
    expect(
      diagnosticsFor(`
      import { createApp } from "__APPLICATION__";
      import { memberSourceOf } from "__MEMBERS__";
      import { defineModule, type FeatureSetup } from "__INSTALLER__";
      import { moduleApi } from "__CONTRACT__";
      interface ProjectApi { name(): string; }
      const ProjectApi = moduleApi<ProjectApi>("project");
      interface AnnotationApi { projectName(): string; }
      const AnnotationApi = moduleApi<AnnotationApi>("annotation");
      class App implements AnnotationApi {
        static readonly contract = AnnotationApi;
        static readonly dependencies = { projects: ProjectApi };
        readonly #projects: ProjectApi;
        private constructor(projects: ProjectApi) { this.#projects = projects; }
        static create({ dependencies }: FeatureSetup<typeof App.dependencies, {}, undefined>): App {
          return new App(dependencies.projects);
        }
        projectName(): string { return this.#projects.name(); }
      }
      const feature = defineModule("annotation").withApp(App).build();
      createApp({ role: "api", members: memberSourceOf({}) })
        .withModules([feature]);
    `),
    ).toEqual([]);
  });

  const cases = [
    [
      "rejects a factory that omits a linked API operation",
      "TS2769",
      `
      import { defineModule } from "__INSTALLER__";
      import { moduleApi } from "__CONTRACT__";
      interface AnnotationApi { save(): string; }
      const AnnotationApi = moduleApi<AnnotationApi>("annotation");
      class App { static readonly contract = AnnotationApi; static readonly dependencies = {}; static create() { return { wrong: true }; } }
      defineModule("annotation").withApp(App).build(); // EXPECT
    `,
    ],
    [
      "rejects service constructor dependencies on API Apps",
      "TS2769",
      `
      import { defineModule, type FeatureSetup } from "__INSTALLER__";
      import { moduleApi } from "__CONTRACT__";
      abstract class ProjectService { abstract name(): string; }
      interface AnnotationApi { save(): string; }
      const AnnotationApi = moduleApi<AnnotationApi>("annotation");
      class App {
        static readonly contract = AnnotationApi;
        static readonly dependencies = { projects: ProjectService };
        static create(setup: FeatureSetup<typeof App.dependencies, {}, undefined>): AnnotationApi { return { save: () => "saved" }; }
      }
      defineModule("annotation").withApp(App).build(); // EXPECT
    `,
    ],

    [
      "rejects an undeclared dependency",
      "TS2339",
      `
      import { defineModule, type FeatureSetup } from "__INSTALLER__";
      abstract class Contract { abstract readonly value: string; }
      class App extends Contract { static readonly contract = Contract; static readonly dependencies = {}; readonly value = "ok"; static create(setup: FeatureSetup<{}, undefined, undefined>): App { setup.dependencies.missing; return new App(); } } // EXPECT
      defineModule("annotation").withApp(App).build();
    `,
    ],
    [
      "rejects a dependency map that disagrees with the factory",
      "TS2769",
      `
      import { defineModule, type FeatureSetup } from "__INSTALLER__";
      abstract class Contract { abstract readonly value: string; }
      abstract class Peer { abstract readonly value: string; }
      class App extends Contract { static readonly contract = Contract; static readonly dependencies = { peer: Peer }; readonly value = "ok"; static create(setup: FeatureSetup<{ other: typeof Peer }, undefined, undefined>): App { return new App(); } }
      defineModule("annotation").withApp(App).build(); // EXPECT
    `,
    ],
    [
      "requires a config schema for typed config",
      "TS2769",
      `
      import { defineModule, type FeatureSetup } from "__INSTALLER__";
      abstract class Contract { abstract readonly value: string; }
      class App extends Contract { static readonly contract = Contract; static readonly dependencies = {}; readonly value = "ok"; static create(setup: FeatureSetup<{}, undefined, { required: string }>): App { return new App(); } }
      defineModule("annotation").withApp(App).build(); // EXPECT
    `,
    ],
    [
      "rejects a schema that disagrees with the factory config",
      "TS2769",
      `
      import { defineModule, type FeatureSetup } from "__INSTALLER__";
      abstract class Contract { abstract readonly value: string; }
      class App extends Contract { static readonly contract = Contract; static readonly dependencies = {}; static readonly configSchema = { parse: (value: unknown): { other: number } => ({ other: 1 }) }; readonly value = "ok"; static create(setup: FeatureSetup<{}, undefined, { required: string }>): App { return new App(); } }
      defineModule("annotation").withApp(App).build(); // EXPECT
    `,
    ],
    [
      "rejects an app result incompatible with its contract",
      "TS2769",
      `
      import { defineModule } from "__INSTALLER__";
      abstract class Contract { abstract readonly value: string; }
      class App { static readonly contract = Contract; static readonly dependencies = {}; static create(): { wrong: boolean } { return { wrong: true }; } }
      defineModule("annotation").withApp(App).build(); // EXPECT
    `,
    ],
    [
      "rejects repository factory requirements that disagree with its argument",
      "TS2322",
      `
      import { defineRepositories } from "__REPOSITORY_REGISTRY__";
      class LiveRepositories {
        static readonly requires = ["prisma"] as const;
        static create({ connection }: { connection: object }) { return { value: "live" }; }
      }
      class MemoryRepositories {
        static readonly requires = [] as const;
        static create() { return { value: "memory" }; }
      }
      defineRepositories({ live: LiveRepositories, memory: MemoryRepositories }); // EXPECT
    `,
    ],
    [
      "rejects repository factories with more than one argument",
      "TS2322",
      `
      import { defineRepositories } from "__REPOSITORY_REGISTRY__";
      class LiveRepositories {
        static readonly requires = ["prisma"] as const;
        static create({ prisma }: { prisma: object }, retry: number) { return { value: prisma, retry }; }
      }
      class MemoryRepositories {
        static readonly requires = [] as const;
        static create() { return { value: "memory" }; }
      }
      defineRepositories({ live: LiveRepositories, memory: MemoryRepositories }); // EXPECT
    `,
    ],
    [
      "rejects a repository backend result the app cannot consume",
      "TS2769",
      `
      import { defineModule, type FeatureSetup } from "__INSTALLER__";
      import { defineRepositories } from "__REPOSITORY_REGISTRY__";
      type Repositories = { value: { read(): string } };
      class LiveRepositories {
        static readonly requires = [] as const;
        static create(): Repositories { return { value: { read: () => "live" } }; }
      }
      class MemoryRepositories {
        static readonly requires = [] as const;
        static create() { return { wrong: true }; }
      }
      const repositories = defineRepositories({ live: LiveRepositories, memory: MemoryRepositories });
      class App {
        static readonly contract = App;
        static readonly dependencies = {};
        static create({ repositories }: FeatureSetup<{}, never, undefined, Repositories>) { return new App(); }
      }
      defineModule("annotation").withRepositories(repositories).withApp(App); // EXPECT
    `,
    ],
  ] as const;

  it.each(cases)("%s", (_name, code, source) => {
    expectOnlyDiagnostic(source, code);
  });

  /** @scenario "A member an installed module names that this process cannot supply" */
  it("rejects a module list whose members lack one a module names", () => {
    expectOnlyDiagnostic(
      `
      import { createApp } from "__APPLICATION__";
      import { memberSourceOf } from "__MEMBERS__";
      import { defineModule, type FeatureSetup } from "__INSTALLER__";
      abstract class Contract { abstract readonly value: string; }
      class App extends Contract { static readonly contract = Contract; static readonly dependencies = {}; readonly value: string; constructor(value: string) { super(); this.value = value; } static create(setup: FeatureSetup<{}, { suffix: string }, undefined>): App { return new App(setup.members.suffix); } }
      const feature = defineModule("annotation").withApp(App).build();
      createApp({ role: "api", members: memberSourceOf({}) })
        .withModules([feature]); // EXPECT
    `,
      "TS2322",
    );
  });
});

/** The one diagnostic a fixture expects, on the line its `// EXPECT` marks. */
function expectOnlyDiagnostic(source: string, code: string): void {
  const expectedLine = source.split("\n").findIndex((line) => line.includes("// EXPECT")) + 1;
  const diagnostics = diagnosticsFor(source);
  expect(
    diagnostics.map(({ line, code: diagnosticCode }) => ({ line, code: diagnosticCode })),
  ).toEqual([{ line: expectedLine, code }]);
}
