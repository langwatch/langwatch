import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectInfrastructureMemberBaseline,
  collectInfrastructureMemberFindings,
  formatBaseline,
  INFRASTRUCTURE_MEMBER_UNUSED_BASELINE,
  lintInfrastructureMembers,
} from "../src/index.ts";
import { snapshotOf } from "./workspace.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "infrastructure-member-"));
  write("modules/widget/server/package.json", JSON.stringify({ name: "@langwatch/widget-server" }));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

const SERVER = "modules/widget/server/src";

const PACKAGE = "modules/widget/server";

const BASELINE = "packages/architecture-enforcer/src/infrastructure-member-unused-baseline.json";

const INFRASTRUCTURE = [
  "export interface WidgetInfrastructure {",
  "  widgetClock: { now(): number };",
  "  widgetLedger: { record(): void };",
  "}",
].join("\n");

/** Rows keyed `<package directory>|<interface>|<member>`. */
function baselineText(keys: readonly string[]): string {
  return formatBaseline({
    policy: INFRASTRUCTURE_MEMBER_UNUSED_BASELINE,
    entries: keys.map((key) => ({ key, measured: "2026-09-10" })),
  });
}

describe("unused infrastructure members", () => {
  describe("given a member no app, service or repository in the package reaches", () => {
    /** @scenario "An infrastructure member no code in the package reaches is reported" */
    it("reports the interface and the member with the instruction to delete both ends", () => {
      write(`${SERVER}/app/widget.infrastructure.ts`, INFRASTRUCTURE);
      write(
        `${SERVER}/app/widget.app.ts`,
        "export const build = (infrastructure: { widgetClock: { now(): number } }): number =>\n  infrastructure.widgetClock.now();\n",
      );

      const found = collectInfrastructureMemberFindings(root);

      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        packagePath: PACKAGE,
        interfaceName: "WidgetInfrastructure",
        member: "widgetLedger",
        path: `${SERVER}/app/widget.infrastructure.ts`,
      });
      expect(found[0]!.message).toContain("no app, service or repository in this package");
      expect(found[0]!.allowed).toContain("Delete the member");
    });

    it("reads a shape written as a type alias the same way as an interface", () => {
      write(
        `${SERVER}/app/widget.infrastructure.ts`,
        "export type WidgetInfrastructure = {\n  widgetLedger: { record(): void };\n};\n",
      );
      write(`${SERVER}/app/widget.app.ts`, "export const build = (): number => 1;\n");

      expect(collectInfrastructureMemberFindings(root).map((one) => one.member)).toEqual([
        "widgetLedger",
      ]);
    });
  });

  describe("given a member the app destructures off its infrastructure record", () => {
    /** @scenario "A member reached by destructuring is a read" */
    it("counts the binding as a read", () => {
      write(`${SERVER}/app/widget.infrastructure.ts`, INFRASTRUCTURE);
      write(
        `${SERVER}/app/widget.app.ts`,
        [
          'import type { WidgetInfrastructure } from "./widget.infrastructure.ts";',
          "export const build = (infrastructure: WidgetInfrastructure): void => {",
          "  const { widgetClock, widgetLedger } = infrastructure;",
          "  widgetLedger.record();",
          "  widgetClock.now();",
          "};",
        ].join("\n"),
      );

      expect(collectInfrastructureMemberFindings(root)).toEqual([]);
    });

    it("counts an indexed read as a read", () => {
      write(`${SERVER}/app/widget.infrastructure.ts`, INFRASTRUCTURE);
      write(
        `${SERVER}/app/widget.app.ts`,
        [
          'import type { WidgetInfrastructure } from "./widget.infrastructure.ts";',
          "export const build = (infrastructure: WidgetInfrastructure): void => {",
          '  infrastructure["widgetClock"].now();',
          '  infrastructure["widgetLedger"].record();',
          "};",
        ].join("\n"),
      );

      expect(collectInfrastructureMemberFindings(root)).toEqual([]);
    });
  });

  describe("given a member only a fixture names", () => {
    /** @scenario "A member only a test names is still dead weight" */
    it("reports it, because a fixture proves the shape rather than using it", () => {
      write(`${SERVER}/app/widget.infrastructure.ts`, INFRASTRUCTURE);
      write(
        `${SERVER}/app/widget.app.ts`,
        "export const build = (infrastructure: { widgetClock: { now(): number } }): number =>\n  infrastructure.widgetClock.now();\n",
      );
      write(
        `${SERVER}/app/__tests__/widget.fixture.ts`,
        "export const fixture = { widgetLedger: { record: () => void 0 } };\n",
      );

      expect(collectInfrastructureMemberFindings(root).map((one) => one.member)).toEqual([
        "widgetLedger",
      ]);
    });
  });

  describe("given a baseline", () => {
    /** @scenario "A baselined infrastructure member is silent and a stale baseline entry is reported" */
    it("silences listed findings and refuses an entry that no longer holds", () => {
      write(`${SERVER}/app/widget.infrastructure.ts`, INFRASTRUCTURE);
      write(`${SERVER}/app/widget.app.ts`, "export const build = (): number => 1;\n");
      write(
        BASELINE,
        baselineText([
          `${PACKAGE}|WidgetInfrastructure|widgetClock`,
          `${PACKAGE}|WidgetInfrastructure|widgetLedger`,
          `${PACKAGE}|WidgetInfrastructure|widgetGone`,
        ]),
      );

      const violations = lintInfrastructureMembers(snapshotOf({ root }));

      expect(violations.map((violation) => violation.policy)).toEqual([
        "infrastructure-member-unused-baseline",
      ]);
      expect(violations[0]!.message).toContain(
        `${PACKAGE} WidgetInfrastructure widgetGone no longer matches anything`,
      );
    });

    it("reports an unlisted finding under the policy name", () => {
      write(`${SERVER}/app/widget.infrastructure.ts`, INFRASTRUCTURE);
      write(`${SERVER}/app/widget.app.ts`, "export const build = (): number => 1;\n");
      write(BASELINE, baselineText([`${PACKAGE}|WidgetInfrastructure|widgetClock`]));

      const policies = lintInfrastructureMembers(snapshotOf({ root })).map(
        (violation) => violation.policy,
      );

      expect(policies).toContain("infrastructure-member-unused");
    });

    it("collects the baseline as rows sorted by key, keeping the date a row carries", () => {
      write(`${SERVER}/app/widget.infrastructure.ts`, INFRASTRUCTURE);
      write(`${SERVER}/app/widget.app.ts`, "export const build = (): number => 1;\n");

      const entries = collectInfrastructureMemberBaseline({
        root,
        previous: [{ key: `${PACKAGE}|WidgetInfrastructure|widgetClock`, measured: "2020-01-01" }],
      });

      expect(entries).toEqual([
        { key: `${PACKAGE}|WidgetInfrastructure|widgetClock`, measured: "2020-01-01" },
        { key: `${PACKAGE}|WidgetInfrastructure|widgetLedger`, measured: expect.any(String) },
      ]);
    });
  });
});
