import { afterAll, describe, expect, it } from "vitest";
import { layerClassRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { project: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/project/server/src/services/example.service.ts";
const ALLOWED =
  "Hold the collaborator at the caller and delete the class, or give it the rules that justify it." +
  " `app/<feature>.app.ts` and routed repositories are exempt.";

function report(code, filename = SERVICE) {
  return runRule(layerClassRule, { code, cwd: workspace.cwd, filename, options: [] });
}

describe("given a TypeScript source the over-abstraction policies read", () => {
  describe("when a class forwards every public method to one collaborator", () => {
    /** @scenario "A class that only forwards to one collaborator is reported as a layer" */
    it("reports deleteTheLayer naming the class, the count and the receiver", () => {
      const found = report(`export class ExampleService {
  constructor(private readonly inner: Inner) {}
  a(input: In): Out { return this.inner.a(input); }
  b(input: In): Out { return this.inner.b(input); }
  c(input: In): Out { return this.inner.c(input); }
  d(input: In): Out { return this.inner.d(input); }
  e(input: In): Out { return this.inner.e(input); }
}`);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("deleteTheLayer");
      expect(found[0].message).toBe(
        "ExampleService forwards 5 of its 5 public methods to a method of the same name on" +
          ` \`this.inner\`. ${ALLOWED}`,
      );
    });

    it("counts arrow properties that bind `this` by field", () => {
      const found = report(`export class ExampleFacade {
  readonly a: Contract["a"] = (...args) => this.inner.a(...args);
  readonly b: Contract["b"] = (...args) => this.inner.b(...args);
  readonly c: Contract["c"] = (...args) => this.inner.c(...args);
  readonly d: Contract["d"] = (...args) => this.inner.d(...args);
  e = (input: In): Out => this.inner.e(input);
}`);

      expect(found.map((entry) => entry.messageId)).toEqual(["deleteTheLayer"]);
    });

    it("sees through `await` in front of the forward", () => {
      const found = report(`export class ExampleService {
  async a(input: In): Promise<Out> { return await this.deps.inner.a(input); }
  async b(input: In): Promise<Out> { return await this.deps.inner.b(input); }
  async c(input: In): Promise<Out> { return await this.deps.inner.c(input); }
  async d(input: In): Promise<Out> { return await this.deps.inner.d(input); }
  async e(input: In): Promise<Out> { return await this.deps.inner.e(input); }
}`);

      expect(found[0].message).toContain("on `this.deps.inner`");
    });
  });

  describe("when the class earns its place", () => {
    /** @scenario "A class that reshapes, guards or fans out is left alone" */
    it("reports nothing for a layer that converts on the way through", () => {
      expect(
        report(`export class ExampleAdapter {
  a(input: In): Out { return this.inner.a(this.toInner(input)); }
  b(input: In): Out { return this.inner.b(this.toInner(input)); }
  c(input: In): Out { return this.inner.c(this.toInner(input)); }
  d(input: In): Out { return this.inner.d(this.toInner(input)); }
  e(input: In): Out { return this.inner.e(this.toInner(input)); }
}`),
      ).toEqual([]);
    });

    it("reports nothing for a class fanning out to several collaborators", () => {
      expect(
        report(`export class ExampleService {
  a(input: In): Out { return this.policy.a(input); }
  b(input: In): Out { return this.catalog.b(input); }
  c(input: In): Out { return this.lifecycle.c(input); }
  d(input: In): Out { return this.tokens.d(input); }
  e(input: In): Out { return this.visibility.e(input); }
}`),
      ).toEqual([]);
    });

    it("reports nothing for a service publishing its own repository's verbs", () => {
      expect(
        report(`export class ExampleService {
  private constructor(private readonly repository: ExampleRepository) {}
  a(input: In): Out { return this.repository.a(input); }
  b(input: In): Out { return this.repository.b(input); }
  c(input: In): Out { return this.repository.c(input); }
  d(input: In): Out { return this.repository.d(input); }
  e(input: In): Out { return this.repository.e(input); }
}`),
      ).toEqual([]);
    });

    it("reports nothing for a class with fewer methods than the floor", () => {
      expect(
        report(`export class ExampleService {
  a(input: In): Out { return this.inner.a(input); }
  b(input: In): Out { return this.inner.b(input); }
}`),
      ).toEqual([]);
    });
  });

  describe("when the file is one the layout requires to forward", () => {
    /** @scenario "The feature facade and the routed repositories are exempt" */
    it("reports nothing for `app/<feature>.app.ts` or a routed repository", () => {
      const facade = `export class ExampleApp {
  a(input: In): Out { return this.deps.example.a(input); }
  b(input: In): Out { return this.deps.example.b(input); }
  c(input: In): Out { return this.deps.example.c(input); }
  d(input: In): Out { return this.deps.example.d(input); }
  e(input: In): Out { return this.deps.example.e(input); }
}`;

      expect(report(facade, "modules/project/server/src/app/example.app.ts")).toEqual([]);
      expect(
        report(
          facade,
          "modules/project/server/src/repositories/routed/routed.example.repository.ts",
        ),
      ).toEqual([]);
    });
  });

  describe("when the file is a test, a declaration or generated", () => {
    /** @scenario "Tests, declarations and generated code are not read at all" */
    it("reports nothing", () => {
      const code = `export class ExampleService {
  constructor(private readonly inner: Inner) {}
  a(input: In): Out { return this.inner.a(input); }
  b(input: In): Out { return this.inner.b(input); }
  c(input: In): Out { return this.inner.c(input); }
  d(input: In): Out { return this.inner.d(input); }
  e(input: In): Out { return this.inner.e(input); }
}`;

      expect(
        report(code, "modules/project/server/src/services/example.service.test.ts"),
      ).toEqual([]);
      expect(
        report(code, "modules/project/server/src/generated/example.service.ts"),
      ).toEqual([]);
    });
  });
});
