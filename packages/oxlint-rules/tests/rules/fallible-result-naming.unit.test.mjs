import { afterAll, describe, expect, it } from "vitest";
import { fallibleResultNamingRule, noTryPrefixRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {}, contract: {} } } },
});

afterAll(() => workspace.cleanup());

const PORT = "modules/agent/server/src/ports/agent.port.ts";
const SERVICE = "modules/agent/server/src/services/agent.service.ts";
const API = "modules/agent/contract/src/agent.api.ts";
const REPOSITORY_INTERFACE = "modules/agent/server/src/repositories/agent.repository.ts";
const REPOSITORY_MEMORY = "modules/agent/server/src/repositories/memory/memory.agent.repository.ts";

function report(code, filename = PORT) {
  return runRule(fallibleResultNamingRule, { code, cwd: workspace.cwd, filename });
}

describe("given a strict feature port module", () => {
  describe("when a try-prefixed method's catch swallows the failure", () => {
    /** @scenario "A try-prefixed method with a swallowing catch is refused" */
    it("reports tryPrefix with the plain rename, for an empty catch", () => {
      const found = report(
        "export class AgentService { async tryFindById(): Promise<string | null> {"
          + " try { return await this.repository.findById(); } catch { return null; } } }",
        SERVICE,
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["tryPrefix"]);
      expect(found[0].data).toEqual({ name: "tryFindById", plain: "findById" });
    });

    /** @scenario "A try-prefixed method with a swallowing catch is refused" */
    it("reports tryPrefix for a catch that returns undefined, whatever the declared return type", () => {
      const found = report(
        "export class AgentService { tryGetById(): string {"
          + " try { return this.compute(); } catch { return undefined; } } }",
        SERVICE,
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["tryPrefix"]);
      expect(found[0].data).toEqual({ name: "tryGetById", plain: "getById" });
    });

    /** @scenario "A try-prefixed method with a swallowing catch is refused" */
    it("reports tryPrefix for a `.catch(() => null)` chain", () => {
      const found = report(
        "export class AgentService { tryResolveUrl(): Promise<string | null> {"
          + " return this.fetch().catch(() => null); } }",
        SERVICE,
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["tryPrefix"]);
      expect(found[0].data).toEqual({ name: "tryResolveUrl", plain: "resolveUrl" });
    });
  });

  describe("when a try-prefixed declaration has no body to swallow anything", () => {
    /** @scenario "A try-prefixed declaration with no catch is not accused of one" */
    it("does not report tryPrefix on an abstract port method", () => {
      const found = report(
        "export abstract class AgentPort { abstract tryFindById(): string | null; }",
      );

      expect(found.map((entry) => entry.messageId)).not.toContain("tryPrefix");
    });

    /** @scenario "A nullable try-prefixed method reports the rename once, not twice" */
    it("reports nothing at all, since no-try-prefix already owns the rename for this name", () => {
      const found = report(
        "export abstract class AgentPort { abstract tryFindById(): string | null; }",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when a try-prefixed method's body does not swallow the failure", () => {
    /** @scenario "A try-prefixed declaration with no catch is not accused of one" */
    it("does not report tryPrefix when the body has no catch at all", () => {
      const found = report(
        "export class AgentService { tryGetById(): string | null {"
          + " return this.cache.get(this.id) ?? null; } }",
        SERVICE,
      );

      expect(found).toEqual([]);
    });

    /** @scenario "A try-prefixed declaration with no catch is not accused of one" */
    it("does not report tryPrefix when the catch rethrows", () => {
      const found = report(
        "export class AgentService { tryGetById(): string {"
          + " try { return this.compute(); } catch (error) { throw this.wrap(error); } } }",
        SERVICE,
      );

      expect(found).toEqual([]);
    });
  });

  describe("when the try-prefix fix is read by the author", () => {
    /** @scenario "Dropping the try prefix means throwing, not renaming to find" */
    it("names the plain rename and refuses find as the alternative", () => {
      const found = report(
        "export class AgentService { tryGetById(): string {"
          + " try { return this.compute(); } catch { return null; } } }",
        SERVICE,
      );

      expect(found[0].message).toContain("Name it `getById`");
      expect(found[0].message).toContain("make the body throw");
      expect(found[0].message).toContain("drop null and undefined from the return type");
    });
  });

  describe("when a method uses the redundant require prefix", () => {
    /** @scenario "The require prefix is reported with a rename fix" */
    it("reports requirePrefix", () => {
      const found = report("export abstract class AgentPort { abstract requireById(): string; }");

      expect(found.map((entry) => entry.messageId)).toContain("requirePrefix");
      expect(found.find((e) => e.messageId === "requirePrefix").message).toBe(
        "`requireById` carries a redundant `require` prefix: a method already answers or throws." +
          " Name it `byId` and leave the body as it is.",
      );
    });
  });

  describe("when a method has no explicit return type", () => {
    /** @scenario "A missing result type is reported" */
    it("reports noResultType", () => {
      const found = report("export abstract class AgentPort { abstract findById(); }");

      expect(found.map((entry) => entry.messageId)).toEqual(["noResultType"]);
    });

    /** @scenario "A missing result type is reported" */
    it("accepts a class whose implemented interface states the type", () => {
      const found = report(
        "export class AgentApp implements AgentApi { getById(input: { id: string }) { return this.service.getById(input); } }",
        "modules/agent/server/src/app/agent.app.ts",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when a nullable result is not a find method", () => {
    /** @scenario "Absence belongs to find methods alone" */
    it("reports nullableWithoutFind on a getter that may answer nothing", () => {
      const found = report(
        "export abstract class AgentPort { abstract getById(): Promise<string | undefined>; }",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["nullableWithoutFind"]);
    });

    /** @scenario "Absence belongs to find methods alone" */
    it("accepts a find method that answers with undefined", () => {
      expect(
        report("export abstract class AgentPort { abstract findById(): string | undefined; }"),
      ).toEqual([]);
    });

    /** @scenario "Absence belongs to find methods alone" */
    it("accepts a getter that always answers or throws", () => {
      expect(report("export abstract class AgentPort { abstract getById(): string; }")).toEqual(
        [],
      );
    });
  });

  describe("when a nullable result is named with the try prefix", () => {
    /** @scenario "A nullable try-prefixed method reports the rename once, not twice" */
    it("does not report nullableWithoutFind, leaving the naming defect to no-try-prefix alone", () => {
      const found = report(
        "export class AgentService { tryGetById(): Promise<string | undefined> {"
          + " return this.cache.get(this.id); } }",
        SERVICE,
      );

      expect(found.map((entry) => entry.messageId)).not.toContain("nullableWithoutFind");
    });

    /** @scenario "A nullable try-prefixed method reports the rename once, not twice" */
    it("still reports noTryPrefix for the very same method, from the other rule", () => {
      const found = runRule(noTryPrefixRule, {
        code:
          "export class AgentService { tryGetById(): Promise<string | undefined> {"
          + " return this.cache.get(this.id); } }",
        cwd: workspace.cwd,
        filename: SERVICE,
      });

      expect(found.map((entry) => entry.messageId)).toEqual(["noTryPrefix"]);
    });
  });
});

describe("given a strict feature API interface", () => {
  describe("when an interface method hedges with the try prefix", () => {
    /** @scenario "A try-prefixed declaration with no catch is not accused of one" */
    it("reports nothing from fallible-result-naming, since no-try-prefix owns the naming defect", () => {
      const found = report(
        "export interface AgentApi { tryGetQueue(input: { id: string }): Promise<string | null>; }",
        API,
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given a repository class or interface file", () => {
  describe("when a repository method is named with get vocabulary", () => {
    /** @scenario "A repository get method is reported" */
    it("reports repositoryServiceVocabulary for getById on a memory repository class", () => {
      const found = report(
        "export class MemoryAgentRepository { getById(): Promise<string> { return this.lookup(); } }",
        REPOSITORY_MEMORY,
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["repositoryServiceVocabulary"]);
      expect(found[0].data).toEqual({ name: "getById", rest: "ById" });
      expect(found[0].message).toBe(
        "Repository method `getById` uses service vocabulary; repositories answer `find*`, services answer `get*`." +
          " Rename it `findById` here and in the repository interface this class implements.",
      );
    });

    /** @scenario "A repository get method is reported" */
    it("reports repositoryServiceVocabulary only, not nullableWithoutFind, when the result is nullable", () => {
      const found = report(
        "export class MemoryAgentRepository { getById(): Promise<string | undefined> { return this.lookup(); } }",
        REPOSITORY_MEMORY,
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["repositoryServiceVocabulary"]);
    });

    /** @scenario "A repository get method is reported" */
    it("maps a bare get to findAll", () => {
      const found = report(
        "export class MemoryAgentRepository { get(): Promise<string[]> { return this.all(); } }",
        REPOSITORY_MEMORY,
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["repositoryServiceVocabulary"]);
      expect(found[0].data).toEqual({ name: "get", rest: "All" });
    });

    /** @scenario "A repository get method is reported" */
    it("leaves a find-prefixed method on the same file alone", () => {
      const found = report(
        "export class MemoryAgentRepository { findById(): Promise<string | null> { return this.lookup(); } }",
        REPOSITORY_MEMORY,
      );

      expect(found).toEqual([]);
    });
  });

  describe("when a repository interface signature is named with list vocabulary", () => {
    /** @scenario "A repository list signature is reported" */
    it("reports repositoryServiceVocabulary for a listActive TSMethodSignature", () => {
      const found = report(
        "export interface AgentRepository { listActive(): Promise<string[]>; }",
        REPOSITORY_INTERFACE,
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["repositoryServiceVocabulary"]);
      expect(found[0].data).toEqual({ name: "listActive", rest: "Active" });
    });

    /** @scenario "A repository list signature is reported" */
    it("leaves a get accessor on the same file alone", () => {
      const found = report(
        "export class MemoryAgentRepository { get id(): string { return this._id; } }",
        REPOSITORY_MEMORY,
      );

      expect(found).toEqual([]);
    });
  });

  describe("when a repository file still carries the other messageIds' defects", () => {
    /** @scenario "The require prefix is reported with a rename fix" */
    it("still reports requirePrefix on a repository file, unaffected by the new vocabulary check", () => {
      const found = report(
        "export interface AgentRepository { requireById(): Promise<string>; }",
        REPOSITORY_INTERFACE,
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["requirePrefix"]);
    });
  });
});

describe("given a file outside the repository path gate", () => {
  describe("when a service method is named with get vocabulary", () => {
    /** @scenario "A service get method is left alone" */
    it("does not report repositoryServiceVocabulary for getById on a service file", () => {
      const found = report(
        "export abstract class AgentPort { abstract getById(): Promise<string | undefined>; }",
        SERVICE,
      );

      expect(found.map((entry) => entry.messageId)).not.toContain("repositoryServiceVocabulary");
      expect(found.map((entry) => entry.messageId)).toEqual(["nullableWithoutFind"]);
    });
  });
});
