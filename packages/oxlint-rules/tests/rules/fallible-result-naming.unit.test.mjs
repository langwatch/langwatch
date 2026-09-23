import { afterAll, describe, expect, it } from "vitest";

import { bannedVerbPrefixRule } from "../../src/rules/banned-verb-prefix.rule.mjs";
import { fallibleResultNamingRule } from "../../src/rules/fallible-result-naming.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {}, contract: {} } } },
});

afterAll(() => workspace.cleanup());

const CONTRACT_SERVICE = "modules/agent/contract/src/agent.service.ts";
const SERVICE = "modules/agent/process/src/services/agent.service.ts";
const API = "modules/agent/contract/src/agent.api.ts";
const REPOSITORY_INTERFACE = "modules/agent/process/src/repositories/agent.repository.ts";
const REPOSITORY_MEMORY =
  "modules/agent/process/src/repositories/memory/memory.agent.repository.ts";

function report(code, filename = CONTRACT_SERVICE) {
  return runRule(fallibleResultNamingRule, { code, cwd: workspace.cwd, filename });
}

describe("given a module file declaring a nullable result", () => {
  describe("when a nullable result is not a find method", () => {
    /** @scenario "A nullable result is reported unless the name is find-prefixed" */
    it("reports nullableWithoutFind on the getter's line", () => {
      const found = report(
        "export abstract class AgentService {\n  abstract getById(): Promise<string | undefined>;\n}",
      );

      expect(found.map((entry) => [entry.messageId, entry.line])).toEqual([
        ["nullableWithoutFind", 2],
      ]);
    });

    /** @scenario "A nullable result is reported unless the name is find-prefixed" */
    it("accepts a find method that answers with undefined", () => {
      expect(
        report("export abstract class AgentService { abstract findById(): string | undefined; }"),
      ).toEqual([]);
    });

    /** @scenario "A nullable result is reported unless the name is find-prefixed" */
    it("accepts a getter that always answers or throws", () => {
      expect(report("export abstract class AgentService { abstract getById(): string; }")).toEqual(
        [],
      );
    });
  });

  describe("when the result is declared through a nullable type alias", () => {
    /** @scenario "A nullable type alias does not hide the absence" */
    it("reports a method whose result is a local alias of T | null, directly or through another alias", () => {
      const found = report(
        [
          "type Maybe<T> = T | null;",
          "export type MaybeOwner = Promise<Maybe<string>>;",
          "export abstract class AgentService {",
          "  abstract getById(): Maybe<string>;",
          "  abstract getOwner(): MaybeOwner;",
          "}",
        ].join("\n"),
      );

      expect(found.map((entry) => [entry.messageId, entry.data.name, entry.line])).toEqual([
        ["nullableWithoutFind", "getById", 4],
        ["nullableWithoutFind", "getOwner", 5],
      ]);
    });

    /** @scenario "A nullable type alias does not hide the absence" */
    it("leaves a method whose alias is not nullable alone", () => {
      expect(
        report(
          "type Name = string;\nexport abstract class AgentService { abstract getById(): Name; }",
        ),
      ).toEqual([]);
    });
  });

  describe("when a module-scope arrow const declares a nullable result", () => {
    /** @scenario "A nullable arrow const is reported like a function" */
    it("reports nullableWithoutFind on the const's line", () => {
      const found = report("\nexport const load = (id: string): string | null => null;", SERVICE);

      expect(found.map((entry) => [entry.messageId, entry.data.name, entry.line])).toEqual([
        ["nullableWithoutFind", "load", 2],
      ]);
    });

    /** @scenario "A nullable arrow const is reported like a function" */
    it("leaves an arrow inside a function body alone", () => {
      expect(
        report(
          'export class AgentService { getAll(): string[] { const load = (): string | null => null; return [load() ?? ""]; } }',
          SERVICE,
        ),
      ).toEqual([]);
    });
  });

  describe("when a method states no result type", () => {
    /** @scenario "A missing result type is left to the native boundary rule" */
    it("reports nothing, since typescript/explicit-module-boundary-types owns it", () => {
      expect(report("export abstract class AgentService { abstract findById(); }")).toEqual([]);
      expect(
        report("export function parseCursor(raw: string) { return raw || undefined; }", SERVICE),
      ).toEqual([]);
    });
  });

  describe("when a nullable result is named with the try prefix", () => {
    /** @scenario "A nullable try-prefixed method reports the rename once, not twice" */
    it("does not report nullableWithoutFind, leaving the naming defect to banned-verb-prefix alone", () => {
      const code =
        "export class AgentService { tryGetById(): Promise<string | undefined> {" +
        " return this.cache.get(this.id); } }";

      expect(report(code, SERVICE)).toEqual([]);
      expect(
        runRule(bannedVerbPrefixRule, { code, cwd: workspace.cwd, filename: SERVICE }).map(
          (entry) => entry.messageId,
        ),
      ).toEqual(["tryPrefix"]);
    });
  });
});

describe("given a strict feature API interface", () => {
  describe("when an interface method hedges with the try prefix", () => {
    /** @scenario "A nullable try-prefixed method reports the rename once, not twice" */
    it("reports nothing from fallible-result-naming, since banned-verb-prefix owns the naming defect", () => {
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
    /** @scenario "A repository get method that cannot answer with absence is left alone" */
    it("leaves getById alone when its result is neither nullable nor an array", () => {
      const found = report(
        "export class MemoryAgentRepository { getById(): Promise<string> { return this.lookup(); } }",
        REPOSITORY_MEMORY,
      );

      expect(found).toEqual([]);
    });

    /** @scenario "A repository get method that cannot answer with absence is left alone" */
    it("still reports a get method whose result is an array, because find names an array", () => {
      const found = report(
        "export class MemoryAgentRepository { getActive(): Promise<string[]> { return this.all(); } }",
        REPOSITORY_MEMORY,
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["repositoryServiceVocabulary"]);
      expect(found[0].data).toEqual({ name: "getActive", rest: "Active" });
    });

    /** @scenario "A repository get method is reported" */
    it("reports repositoryServiceVocabulary for a nullable getById on a memory repository class", () => {
      const found = report(
        "export class MemoryAgentRepository { getById(): Promise<string | null> { return this.lookup(); } }",
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
});

describe("given a file outside the repository path gate", () => {
  describe("when a service method is named with get vocabulary", () => {
    /** @scenario "A service get method is left alone" */
    it("does not report repositoryServiceVocabulary for getById on a service file", () => {
      const found = report(
        "export class AgentService { getById(): Promise<string | undefined> { return this.lookup(); } }",
        SERVICE,
      );

      expect(found.map((entry) => entry.messageId)).not.toContain("repositoryServiceVocabulary");
      expect(found.map((entry) => entry.messageId)).toEqual(["nullableWithoutFind"]);
    });
  });
});

describe("given a nullable function named for a conversion rather than a lookup", () => {
  describe("when the conversion declares a nullable result", () => {
    /** @scenario "A conversion that answers with absence is left alone" */
    it("leaves parse, extract, build, stringify, decode and as prefixed conversions alone", () => {
      for (const name of [
        "parseKsuidCreatedAtMs",
        "extractMessageText",
        "buildDisplayInput",
        "stringifySpanIO",
        "decodeCursor",
        "asChatMessages",
      ]) {
        const found = report(
          `export function ${name}(raw: unknown): string | undefined { return undefined; }`,
          SERVICE,
        );

        expect(found.map((entry) => entry.messageId)).not.toContain("nullableWithoutFind");
      }
    });

    /** @scenario "A conversion that answers with absence is left alone" */
    it("still reports a lookup-named nullable function in the same file", () => {
      const found = report(
        "export function lookupWidget(id: string): string | undefined { return undefined; }",
        SERVICE,
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["nullableWithoutFind"]);
    });
  });
});

describe("given the guidance the nullableWithoutFind message hands a reader", () => {
  describe("when a nullable non-find method is reported", () => {
    /** @scenario "A nullable result is reported unless the name is find-prefixed" */
    it("names get and throwing, and refuses a new nullable find, per the 2026-09-16 naming decision", () => {
      const found = report(
        "export class AgentService { resolveOwner(): string | undefined { return undefined; } }",
        SERVICE,
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["nullableWithoutFind"]);

      const advice = `${found[0].message ?? ""} ${found[0].fix ?? ""}`;
      expect(advice).toContain("get<Noun>");
      expect(advice).toContain("throw");
      expect(advice).not.toMatch(/rename .* to `find<Noun>`[^]*keep the nullable/);
    });
  });
});

describe("given a derivation that computes its answer from its argument", () => {
  describe("when it answers undefined because the input carried none", () => {
    /** @scenario "A derivation verb may answer undefined" */
    it("reports nothing for the verbs ADR-146 names", () => {
      const derivations = [
        "inferOriginFromLegacyMarkers(span: Span): string | undefined { return undefined; }",
        "classifyKind(row: Row): Kind | undefined { return undefined; }",
        "detectFormat(bytes: Uint8Array): Format | undefined { return undefined; }",
        "pickPrimary(items: Item[]): Item | undefined { return undefined; }",
        "describeAnchor(anchor: Anchor): string | undefined { return undefined; }",
        "mapSeverity(level: string): Severity | undefined { return undefined; }",
      ];

      for (const method of derivations) {
        expect(report(`export class AgentService { ${method} }`, SERVICE)).toEqual([]);
      }
    });
  });

  describe("when the verb reads both as a derivation and as a lookup", () => {
    /** @scenario "resolve and read stay governed" */
    it("still reports resolve and read, which ADR-146 decides per call site", () => {
      const governed = [
        "resolveProjectId(teamId: string): string | undefined { return undefined; }",
        "readOwner(id: string): string | undefined { return undefined; }",
      ];

      for (const method of governed) {
        const found = report(`export class AgentService { ${method} }`, SERVICE);

        expect(found.map((entry) => entry.messageId)).toEqual(["nullableWithoutFind"]);
      }
    });
  });
});
