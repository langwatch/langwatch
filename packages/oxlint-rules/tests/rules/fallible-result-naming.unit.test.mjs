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
    it("reports nullableOneValue on the getter's line", () => {
      const found = report(
        "export abstract class AgentService {\n  abstract getById(): Promise<string | undefined>;\n}",
      );

      expect(found.map((entry) => [entry.messageId, entry.line])).toEqual([
        ["nullableOneValue", 2],
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
    it("reports nullableOneValue on the const's line", () => {
      const found = report("\nexport const load = (id: string): string | null => null;", SERVICE);

      expect(found.map((entry) => [entry.messageId, entry.data.name, entry.line])).toEqual([
        ["nullableOneValue", "load", 2],
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
      ).toEqual(["tryPrefixOneValue"]);
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
    it("reports repositoryServiceVocabulary with the find rename for a nullable array answer", () => {
      const found = report(
        "export class MemoryAgentRepository { getById(): Promise<string[] | null> { return this.lookup(); } }",
        REPOSITORY_MEMORY,
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["repositoryServiceVocabulary"]);
      expect(found[0].data).toEqual({ name: "getById", rest: "ById" });
      expect(found[0].message).toBe(
        "Repository method `getById` uses service vocabulary; repositories answer `find*`, services answer `get*`." +
          " Rename it `findById` here and in the repository interface this class implements.",
      );
    });

    /** @scenario "A repository read answering one value is pointed at a throwing get, never find" */
    it("reports repositoryOneValue for a nullable one-object getById, naming get and a result union", () => {
      const found = report(
        "export class MemoryAgentRepository { getOrganizationDirectory(): Promise<Directory | null> { return this.lookup(); } }",
        REPOSITORY_MEMORY,
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["repositoryOneValue"]);
      expect(found[0].data).toEqual({
        name: "getOrganizationDirectory",
        rest: "OrganizationDirectory",
      });
      expect(found[0].message).toContain("Name it `getOrganizationDirectory`");
      expect(found[0].message).toContain("explicit result union");
      expect(found[0].message).not.toContain("Rename it `findOrganizationDirectory`");
    });

    /** @scenario "A repository read answering one value is pointed at a throwing get, never find" */
    it("keeps a bare get as get, and leaves a list read answering a page alone", () => {
      const found = report(
        [
          "export interface AgentRepository {",
          "  listPage(): Promise<{ items: string[]; cursor?: string }>;",
          "  get(key: string): Promise<string | null>;",
          "}",
        ].join("\n"),
        REPOSITORY_INTERFACE,
      );

      expect(found.map((entry) => [entry.messageId, entry.data.rest])).toEqual([
        ["repositoryOneValue", ""],
      ]);
    });

    /** @scenario "A repository get method is reported" */
    it("reports the repository finding only, not nullableWithoutFind, when the result is nullable", () => {
      const found = report(
        "export class MemoryAgentRepository { getById(): Promise<string | undefined> { return this.lookup(); } }",
        REPOSITORY_MEMORY,
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["repositoryOneValue"]);
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
      expect(found.map((entry) => entry.messageId)).toEqual(["nullableOneValue"]);
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

        expect(found).toEqual([]);
      }
    });

    /** @scenario "A conversion that answers with absence is left alone" */
    it("still reports a lookup-named nullable function in the same file", () => {
      const found = report(
        "export function lookupWidget(id: string): string | undefined { return undefined; }",
        SERVICE,
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["nullableOneValue"]);
    });
  });
});

describe("given the guidance the nullableWithoutFind message hands a reader", () => {
  describe("when a nullable non-find method is reported", () => {
    /** @scenario "A nullable result is reported unless the name is find-prefixed" */
    it("names get and throwing, and refuses a new nullable find, per the 2026-09-16 naming decision", () => {
      const found = report(
        "export class AgentService { resolveOwners(): string[] | undefined { return undefined; } }",
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
        "foldIdentifier(state: State | null, event: Event): State | null { return state; }",
        "reduceSession(state: State | null, event: Event): State | null { return state; }",
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

        expect(found.map((entry) => entry.messageId)).toEqual(["nullableOneValue"]);
      }
    });
  });
});

describe("given a nullable result that answers one value", () => {
  describe("when the answer, set apart from null and undefined, is not an array", () => {
    /** @scenario "A nullable one-value result is pointed at a throwing get or a result union, never find" */
    it("names get, throwing and a result union, and tells the author not to rename it find", () => {
      const [finding] = report(
        "export class AgentService { loadOwner(): Promise<Owner | null> { return this.lookup(); } }",
        SERVICE,
      );

      expect(finding.messageId).toBe("nullableOneValue");
      expect(finding.message).toContain("`get<Noun>`");
      expect(finding.message).toContain("throw the domain error");
      expect(finding.message).toContain("explicit result union");
      expect(finding.message).toContain("Do not rename it `find*`");
      expect(finding.message).not.toContain("name it `find<Noun>`");
    });

    /** @scenario "A nullable one-value result is pointed at a throwing get or a result union, never find" */
    it("keeps nullableWithoutFind when the answer is an array, a local array alias or unknown", () => {
      const found = report(
        [
          "type Rows = string[];",
          "export abstract class AgentService {",
          "  abstract loadRows(): Promise<Rows | null>;",
          "  abstract loadMany(): ReadonlyArray<string> | undefined;",
          "  abstract loadAny(): unknown | undefined;",
          "}",
        ].join("\n"),
        SERVICE,
      );

      expect(found.map((entry) => [entry.messageId, entry.data.name])).toEqual([
        ["nullableWithoutFind", "loadRows"],
        ["nullableWithoutFind", "loadMany"],
        ["nullableWithoutFind", "loadAny"],
      ]);
    });
  });
});

describe("given a declaration whose name and shape a vendor's callback interface dictates", () => {
  describe("when it implements or is typed by something imported from a vendor package", () => {
    /** @scenario "A vendor callback is exempt, and our own interface of the same shape is not" */
    it("leaves methods of a vendor-implementing class and vendor-typed consts alone", () => {
      const declarations = (vendor) =>
        [
          `import type { BetterAuthOptions } from "${vendor("better-auth")}";`,
          `import * as Vendor from "${vendor("vendor-sdk")}";`,
          `import { Transport } from "${vendor("winston-transport")}";`,
          "export class Hooks implements Vendor.Hooks {",
          "  beforeUserCreate(): Promise<boolean | undefined> { return this.check(); }",
          "}",
          "export class LogSink extends Transport { lookup(): string | null { return null; } }",
          'export const beforeSessionCreate: NonNullable<BetterAuthOptions["databaseHooks"]>["session"] =',
          "  async (): Promise<boolean | undefined> => undefined;",
          "export const beforeAccountCreate: Vendor.AccountHook = async (): Promise<string | undefined> => undefined;",
        ].join("\n");

      expect(
        report(
          declarations((name) => name),
          SERVICE,
        ),
      ).toEqual([]);
      expect(
        report(
          declarations((name) => `./${name}.ts`),
          SERVICE,
        ).map((entry) => entry.data.name),
      ).toEqual(["beforeUserCreate", "lookup", "beforeSessionCreate", "beforeAccountCreate"]);
    });
  });

  describe("when the type it implements or carries is ours", () => {
    /** @scenario "A vendor callback is exempt, and our own interface of the same shape is not" */
    it("still reports a hook-named method or const typed by a @langwatch, relative or mixed heritage", () => {
      const found = report(
        [
          'import type { AuthHookApi } from "@langwatch/auth-contract";',
          'import type { LocalHooks } from "./local-hooks.ts";',
          'import type { SdkHooks } from "langwatch/observability";',
          'import type { BetterAuthOptions } from "better-auth";',
          "export class OwnHooks implements AuthHookApi { beforeUserCreate(): Promise<boolean | undefined> { return this.check(); } }",
          "export class Mixed implements BetterAuthOptions, LocalHooks { beforeUserCreate(): boolean | undefined { return undefined; } }",
          "export class Sdk implements SdkHooks { beforeUserCreate(): boolean | undefined { return undefined; } }",
          "export class Plain { beforeUserCreate(): boolean | undefined { return undefined; } }",
          "export const beforeSessionCreate: LocalHooks = async (): Promise<boolean | undefined> => undefined;",
          "export const beforeAccountCreate = async (): Promise<boolean | undefined> => undefined;",
        ].join("\n"),
        SERVICE,
      );

      expect(found.map((entry) => [entry.messageId, entry.data.name, entry.line])).toEqual([
        ["nullableOneValue", "beforeUserCreate", 5],
        ["nullableOneValue", "beforeUserCreate", 6],
        ["nullableOneValue", "beforeUserCreate", 7],
        ["nullableOneValue", "beforeUserCreate", 8],
        ["nullableOneValue", "beforeSessionCreate", 9],
        ["nullableOneValue", "beforeAccountCreate", 10],
      ]);
    });
  });
});

describe("given a read whose declared answer is a page", () => {
  const PAGE_DECLARATIONS = [
    "interface AgentPage { data: Agent[]; total: number }",
    "type Page<T> = { items: T[]; nextCursor?: string };",
  ].join("\n");

  describe("when a repository names it with list vocabulary", () => {
    /** @scenario "A repository list read answering a page keeps list" */
    it("leaves an inline page, a local interface page and a local generic page alias alone", () => {
      const found = report(
        [
          PAGE_DECLARATIONS,
          "export interface AgentRepository {",
          "  listPage(): Promise<{ runs: Agent[]; totalHits: number }>;",
          "  listActive(): Promise<AgentPage>;",
          "  listArchived(): Promise<Page<Agent>>;",
          "}",
        ].join("\n"),
        REPOSITORY_INTERFACE,
      );

      expect(found).toEqual([]);
    });

    /** @scenario "A repository list read answering a page keeps list" */
    it("still reports a list read answering a plain array or a plain object", () => {
      const found = report(
        [
          "export class MemoryAgentRepository {",
          "  listActive(): Promise<Agent[]> { return this.all(); }",
          "  listSummary(): Promise<{ id: string; names: string[] }> { return this.summary(); }",
          "  listCounts(): Promise<{ id: string; total: number }> { return this.counts(); }",
          "}",
        ].join("\n"),
        REPOSITORY_MEMORY,
      );

      expect(found.map((entry) => [entry.messageId, entry.data.name])).toEqual([
        ["repositoryServiceVocabulary", "listActive"],
        ["repositoryServiceVocabulary", "listSummary"],
        ["repositoryServiceVocabulary", "listCounts"],
      ]);
    });
  });

  describe("when it is named with find vocabulary", () => {
    /** @scenario "A find read answering a page is pointed at list" */
    it("reports findAnswersPage naming the list rename, in a repository and in a service", () => {
      const repository = report(
        [
          PAGE_DECLARATIONS,
          "export abstract class AgentRepository {",
          "  abstract findPage(): Promise<{ data: Agent[]; total: number }>;",
          "  abstract findArchived(): Promise<AgentPage | null>;",
          "}",
        ].join("\n"),
        REPOSITORY_INTERFACE,
      );
      const service = report(
        [
          PAGE_DECLARATIONS,
          "export class AgentService {",
          "  findRecent(): Promise<Page<Agent>> { return this.recent(); }",
          "}",
        ].join("\n"),
        SERVICE,
      );

      expect(
        [...repository, ...service].map((entry) => [entry.messageId, entry.data.rest]),
      ).toEqual([
        ["findAnswersPage", "Page"],
        ["findAnswersPage", "Archived"],
        ["findAnswersPage", "Recent"],
      ]);
      expect(service[0].message).toContain("Rename it `listRecent`");
    });

    /** @scenario "A find read answering a page is pointed at list" */
    it("leaves a find answering an array, and never points a one-object find at list", () => {
      const found = report(
        [
          "export class AgentService {",
          "  findActive(): Promise<Agent[]> { return this.active(); }",
          "  findItems(): Promise<{ items: Agent[] }> { return this.items(); }",
          "  findTotal(): Promise<{ id: string; total: number }> { return this.total(); }",
          "  findRunState(): Promise<{ total: number; recentEvents?: string[] }> { return this.state(); }",
          "  findById(): Promise<Agent | null> { return this.lookup(); }",
          "}",
        ].join("\n"),
        SERVICE,
      );

      expect(found.map((entry) => entry.messageId)).not.toContain("findAnswersPage");
    });
  });
});
