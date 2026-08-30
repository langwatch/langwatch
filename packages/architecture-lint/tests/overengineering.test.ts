import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintOverengineering, type ClassifiedPackage } from "../src";

let root = "";

function serverPackage(): ClassifiedPackage {
  const featureRoot = join(root, "packages/features/example");
  const serverRoot = join(featureRoot, "server");
  return {
    name: "@langwatch/example-server",
    root: serverRoot,
    manifestPath: join(serverRoot, "package.json"),
    manifest: {},
    kind: "server",
    feature: "example",
    featureRoot,
    layoutVersion: 0,
    subjects: [],
    enterprise: false,
  };
}

function write(relativePath: string, source: string): void {
  root ||= mkdtempSync(join(tmpdir(), "overengineering-"));
  const file = join(root, relativePath);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, source);
}

function lint(): ReturnType<typeof lintOverengineering> {
  return lintOverengineering(root, [serverPackage()]);
}

function policies(): string[] {
  return lint().map((violation) => violation.policy);
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("lintOverengineering", () => {
  describe("given a class whose methods forward to the same name on a collaborator", () => {
    it("reports it as a layer", () => {
      write(
        "packages/features/example/server/src/services/example.service.ts",
        `export class ExampleService {
  constructor(private readonly inner: Inner) {}
  a(input: In): Out { return this.inner.a(input); }
  b(input: In): Out { return this.inner.b(input); }
  c(input: In): Out { return this.inner.c(input); }
  d(input: In): Out { return this.inner.d(input); }
  e(input: In): Out { return this.inner.e(input); }
}`,
      );

      const [violation] = lint();

      expect(violation?.policy).toBe("layer-class");
      expect(violation?.message).toContain("5 of its 5");
    });

    it("counts the arrow-property spelling a binding facade uses", () => {
      write(
        "packages/features/example/server/src/services/example.service.ts",
        `export class ExampleFacade {
  readonly a: Contract["a"] = (...args) => this.inner.a(...args);
  readonly b: Contract["b"] = (...args) => this.inner.b(...args);
  readonly c: Contract["c"] = (...args) => this.inner.c(...args);
  readonly d: Contract["d"] = (...args) => this.inner.d(...args);
  e = (input: In): Out => this.inner.e(input);
}`,
      );

      const [violation] = lint();

      expect(violation?.policy).toBe("layer-class");
      expect(violation?.message).toContain("5 of its 5");
    });

    it("counts an awaited forward too", () => {
      write(
        "packages/features/example/server/src/services/example.service.ts",
        `export class ExampleService {
  async a(input: In): Promise<Out> { return await this.deps.inner.a(input); }
  async b(input: In): Promise<Out> { return await this.deps.inner.b(input); }
  async c(input: In): Promise<Out> { return await this.deps.inner.c(input); }
  async d(input: In): Promise<Out> { return await this.deps.inner.d(input); }
  async e(input: In): Promise<Out> { return await this.deps.inner.e(input); }
}`,
      );

      expect(policies()).toEqual(["layer-class"]);
    });
  });

  describe("given a class that does work of its own", () => {
    it("reports nothing", () => {
      write(
        "packages/features/example/server/src/services/example.service.ts",
        `export class ExampleService {
  a(input: In): Out { this.guard(input); return this.inner.a(input); }
  b(input: In): Out { return this.inner.findB(input); }
  c(input: In): Out { return this.inner.c(input); }
  d(input: In): Out { return transform(this.inner.d(input)); }
  e(input: In): Out { return this.inner.e(input); }
}`,
      );

      expect(policies()).toEqual([]);
    });

    it("does not count an arrow property that renames the call", () => {
      write(
        "packages/features/example/server/src/services/example.service.ts",
        `export class ExampleService {
  readonly a: Contract["a"] = (...args) => this.inner.findA(...args);
  readonly b: Contract["b"] = (...args) => this.inner.findB(...args);
  readonly c: Contract["c"] = (...args) => this.inner.findC(...args);
  readonly d: Contract["d"] = (...args) => this.inner.findD(...args);
  readonly e: Contract["e"] = (...args) => this.inner.findE(...args);
}`,
      );

      expect(policies()).toEqual([]);
    });

    it("exempts the one facade the feature layout requires", () => {
      write(
        "packages/features/example/server/src/app/example.app.ts",
        `export class ExampleApp {
  a(input: In): Out { return this.deps.example.a(input); }
  b(input: In): Out { return this.deps.example.b(input); }
  c(input: In): Out { return this.deps.example.c(input); }
  d(input: In): Out { return this.deps.example.d(input); }
  e(input: In): Out { return this.deps.example.e(input); }
}`,
      );

      expect(policies()).toEqual([]);
    });

    it("exempts a routed repository, whose job is to pick a backend by the same verb", () => {
      write(
        "packages/features/example/server/src/repositories/routed/routed.example.repository.ts",
        `export class RoutedExampleRepository {
  a(input: In): Out { return this.primary.a(input); }
  b(input: In): Out { return this.primary.b(input); }
  c(input: In): Out { return this.primary.c(input); }
  d(input: In): Out { return this.primary.d(input); }
  e(input: In): Out { return this.primary.e(input); }
}`,
      );

      expect(policies()).toEqual([]);
    });

    it("ignores a class with fewer methods than the floor", () => {
      write(
        "packages/features/example/server/src/services/example.service.ts",
        `export class ExampleService {
  a(input: In): Out { return this.inner.a(input); }
  b(input: In): Out { return this.inner.b(input); }
}`,
      );

      expect(policies()).toEqual([]);
    });
  });

  describe("given a type alias built from deeply nested conditional types", () => {
    it("reports the nesting depth", () => {
      write(
        "packages/features/example/server/src/services/example.service.ts",
        `export type Resolve<T> = T extends A
  ? 1
  : T extends B
    ? 2
    : T extends C
      ? 3
      : T extends D
        ? 4
        : 5;`,
      );

      const [violation] = lint();

      expect(violation?.policy).toBe("conditional-type-depth");
      expect(violation?.message).toContain("nests 4 conditional types");
    });

    it("allows a shallow one", () => {
      write(
        "packages/features/example/server/src/services/example.service.ts",
        `export type Resolve<T> = T extends A ? 1 : T extends B ? 2 : 3;`,
      );

      expect(policies()).toEqual([]);
    });
  });

  describe("given overloads that differ only by a boolean literal option", () => {
    it("reports the option that carries the difference", () => {
      write(
        "packages/features/example/server/src/services/example.service.ts",
        `export function configUrl(options?: { env?: string; optional?: false }): Leaf<string>;
export function configUrl(options: { env?: string; optional: true }): Leaf<string | undefined>;
export function configUrl(options?: { env?: string; optional?: boolean }): Leaf<string | undefined> {
  return leaf(options);
}`,
      );

      const [violation] = lint();

      expect(violation?.policy).toBe("overload-by-literal");
      expect(violation?.message).toContain("`optional: true` versus `optional: false`");
    });

    it("allows overloads that differ by more than a literal flag", () => {
      write(
        "packages/features/example/server/src/services/example.service.ts",
        `export function create(options: SchemaOptions): Config;
export function create(options: DefinitionOptions): Config;
export function create(options: SchemaOptions | DefinitionOptions): Config {
  return build(options);
}`,
      );

      expect(policies()).toEqual([]);
    });
  });
});
