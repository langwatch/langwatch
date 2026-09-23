import { afterAll, describe, expect, it } from "vitest";

import { bannedVerbPrefixRule } from "../../src/rules/banned-verb-prefix.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {}, contract: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/agent/process/src/services/agent.service.ts";
const API = "modules/agent/contract/src/agent.api.ts";
const REPOSITORY = "modules/agent/process/src/repositories/agent.repository.ts";

function report(code, filename = SERVICE) {
  return runRule(bannedVerbPrefixRule, { code, cwd: workspace.cwd, filename });
}

function located(found) {
  return found.map((entry) => [entry.messageId, entry.data.name, entry.line]);
}

describe("given a try-prefixed name with no catch to swallow anything", () => {
  describe("when it is an interface signature, an abstract method, a method or a function", () => {
    /** @scenario "A try-prefixed name is refused without claiming a catch" */
    it("reports tryPrefix once per name, on its line", () => {
      const found = report(
        [
          "export abstract class AgentService {",
          "  abstract tryFindById(): string | null;",
          "  tryGetById(): string | null { return this.cache.get(this.id) ?? null; }",
          "}",
          "export function tryParse(input: string): number | null { return Number(input); }",
          "export const tryLoad = (): string | null => null;",
        ].join("\n"),
      );

      expect(located(found)).toEqual([
        ["tryPrefix", "tryFindById", 2],
        ["tryPrefix", "tryGetById", 3],
        ["tryPrefix", "tryParse", 5],
        ["tryPrefix", "tryLoad", 6],
      ]);
    });

    /** @scenario "A try-prefixed name is refused without claiming a catch" */
    it("reports tryPrefix on an API interface member", () => {
      const found = report(
        "export interface AgentApi { tryGetQueue(input: { id: string }): Promise<string | null>; }",
        API,
      );

      expect(located(found)).toEqual([["tryPrefix", "tryGetQueue", 1]]);
    });

    /** @scenario "A try-prefixed name is refused without claiming a catch" */
    it("does not accuse a catch that rethrows", () => {
      const found = report(
        "export class AgentService { tryGetById(): string {" +
          " try { return this.compute(); } catch (error) { throw this.wrap(error); } } }",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["tryPrefix"]);
    });
  });

  describe("when the message is read by the author", () => {
    /** @scenario "The try message never claims a catch and never prescribes a nullable find" */
    it("names the ADR-146 renames without mentioning a catch", () => {
      const [finding] = report(
        "export function tryParse(input: string): number | null { return null; }",
      );

      expect(finding.message).not.toMatch(/catch/i);
      expect(finding.message).toContain("Drop `try`");
      expect(finding.message).toContain("`get<Noun>`");
      expect(finding.message).toContain("`find<Noun>` returning an array");
      expect(finding.message).toContain("Never rename it to a `find*` that still answers null");
    });
  });
});

describe("given a try-prefixed name whose own body swallows a failure", () => {
  describe("when a catch answers null, undefined or nothing, or a chain ends in `.catch(() => null)`", () => {
    /** @scenario "A swallowing try is reported once, naming its catch" */
    it("reports swallowingTry and not tryPrefix, once per name", () => {
      const found = report(
        [
          "export class AgentService {",
          "  async tryFindById(): Promise<string | null> { try { return await this.find(); } catch { return null; } }",
          "  tryGetById(): string { try { return this.compute(); } catch { return undefined; } }",
          "  tryResolveUrl(): Promise<string | null> { return this.fetch().catch(() => null); }",
          "}",
          "export const tryLoad = () => load().catch(() => undefined);",
        ].join("\n"),
      );

      expect(located(found)).toEqual([
        ["swallowingTry", "tryFindById", 2],
        ["swallowingTry", "tryGetById", 3],
        ["swallowingTry", "tryResolveUrl", 4],
        ["swallowingTry", "tryLoad", 6],
      ]);
    });

    /** @scenario "A swallowing try is reported once, naming its catch" */
    it("tells the author to delete the catch and never to rename to a nullable find", () => {
      const [finding] = report(
        "export class AgentService { tryGetById(): string { try { return this.compute(); } catch { return null; } } }",
      );

      expect(finding.message).toContain("Delete the catch that answers null or undefined");
      expect(finding.message).toContain("Never rename it to a `find*` that still answers null");
      expect(finding.message).not.toMatch(/Keep a nullable/);
    });
  });
});

describe("given a require-prefixed name", () => {
  describe("when a method, interface signature or function is named require<Noun>", () => {
    /** @scenario "A require prefix is reported with the get rename" */
    it("reports requirePrefix naming get<Noun> as the rename", () => {
      const found = report(
        "export interface AgentRepository {\n  requireById(): Promise<string>;\n}",
        REPOSITORY,
      );

      expect(located(found)).toEqual([["requirePrefix", "requireById", 2]]);
      expect(found[0].message).toBe(
        "`requireById` carries a `require` prefix, which says how it fails rather than what it answers." +
          " Name it `getById` and leave the body as it is: ADR-146's `get` already answers exactly one thing or throws.",
      );
    });
  });
});

describe("given a require-prefixed name that answers nothing", () => {
  describe("when it returns void, Promise<void> or asserts, or its body returns no value", () => {
    /** @scenario "A require prefix that throws on failure is reported with the assert rename" */
    it("reports requireAssertion naming assert<Condition> as the rename, on each name's line", () => {
      const found = report(
        [
          "export interface AgentGuard {",
          "  requireAdmin(): void;",
          "  requireOwner(): Promise<void>;",
          "  requireProject(value: unknown): asserts value is string;",
          "}",
          "export function requireSeat(count: number) {",
          "  if (count < 1) throw new Error('no seat');",
          "  return;",
          "}",
          "export const requireQuota = async (used: number) => {",
          "  if (used > 10) throw new Error('over');",
          "};",
        ].join("\n"),
      );

      expect(located(found)).toEqual([
        ["requireAssertion", "requireAdmin", 2],
        ["requireAssertion", "requireOwner", 3],
        ["requireAssertion", "requireProject", 4],
        ["requireAssertion", "requireSeat", 6],
        ["requireAssertion", "requireQuota", 10],
      ]);
      expect(found[0].message).toBe(
        "`requireAdmin` carries a `require` prefix, which says how it fails rather than what it checks." +
          " Name it `assertAdmin` and leave the body as it is: an `assert*` answers nothing and throws when the condition fails.",
      );
    });
  });

  describe("when its body returns a value", () => {
    /** @scenario "A require prefix is reported with the get rename" */
    it("reports requirePrefix, not requireAssertion", () => {
      const found = report(
        [
          "export function requireSeat(count: number) {",
          "  if (count < 1) throw new Error('no seat');",
          "  return count;",
          "}",
          "export const requireQuota = (used: number) => used;",
        ].join("\n"),
      );

      expect(located(found)).toEqual([
        ["requirePrefix", "requireSeat", 1],
        ["requirePrefix", "requireQuota", 5],
      ]);
    });
  });
});

describe("given a name the prefixes do not govern", () => {
  /** @scenario "A private or unprefixed name is left alone" */
  it("leaves a private try method, a nested arrow and a plain find alone", () => {
    const found = report(
      [
        "export class AgentService {",
        "  private tryGetById(): string | null { return null; }",
        "  findAll(): string[] { const tryOne = () => null; return [String(tryOne())]; }",
        "}",
      ].join("\n"),
    );

    expect(found).toEqual([]);
  });
});
