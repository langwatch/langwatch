import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectCompositionRootBudget,
  collectCompositionRootBudgetFindings,
  collectMountFileIsOneCallBaseline,
  collectMountFileIsOneCallFindings,
  collectPortsAndAdaptersFoldersBaseline,
  collectPortsAndAdaptersFoldersFindings,
  collectRestDoorWithoutMountBaseline,
  collectRestDoorWithoutMountFindings,
  formatBaseline,
  lintCompositionRootMayOnlyShrink,
  lintMountFileIsOneCall,
  lintPortsAndAdaptersFolders,
  lintRestDoorWithoutMount,
  MOUNT_FILE_IS_ONE_CALL_BASELINE,
  PORTS_AND_ADAPTERS_FOLDERS_BASELINE,
  REST_DOOR_WITHOUT_MOUNT_BASELINE,
} from "../src/index.ts";
import { snapshotOf } from "./workspace.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "shape-counters-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

const DOORS_FILE = "apps/api/src/app-rest/api-rest.doors.ts";
const PORTS_BASELINE = "packages/architecture-lint/src/ports-and-adapters-folders-baseline.json";
const DOORS_BASELINE = "packages/architecture-lint/src/rest-door-without-mount-baseline.json";
const MOUNT_BASELINE = "packages/architecture-lint/src/mount-file-is-one-call-baseline.json";
const BUDGET_FILE = "packages/architecture-lint/src/composition-root-line-budget.json";

function baselineText(policy: typeof REST_DOOR_WITHOUT_MOUNT_BASELINE, keys: readonly string[]): string {
  return formatBaseline({
    policy,
    entries: keys.map((key) => ({ key, measured: "2026-09-10" })),
  });
}

describe("rest door without mount", () => {
  describe("given a door entry with no mount field", () => {
    /** @scenario An unconverted door is refused with the instruction to declare its mount */
    it("reports the door by its family name", () => {
      write(
        DOORS_FILE,
        `export const API_REST_DOORS = [
  { family: "widget", owner: "process", paths: ["/api/widget"] },
  {
    family: "gadget",
    owner: "process",
    paths: ["/api/gadget"],
    mount: ({ runtime }) => [runtime.mount(gadgetRest.router(), () => api)],
  },
];
`,
      );

      const findings = collectRestDoorWithoutMountFindings(root);

      expect(findings.map((finding) => finding.family)).toEqual(["widget"]);
    });
  });

  describe("given every door declares a mount", () => {
    it("reports nothing", () => {
      write(
        DOORS_FILE,
        `export const API_REST_DOORS = [
  {
    family: "gadget",
    owner: "process",
    paths: ["/api/gadget"],
    mount: ({ runtime }) => [runtime.mount(gadgetRest.router(), () => api)],
  },
];
`,
      );

      expect(collectRestDoorWithoutMountFindings(root)).toEqual([]);
    });
  });

  describe("given a baseline", () => {
    it("silences a listed family and refuses a stale entry", () => {
      write(
        DOORS_FILE,
        `export const API_REST_DOORS = [
  { family: "widget", owner: "process", paths: ["/api/widget"] },
];
`,
      );
      write(DOORS_BASELINE, baselineText(REST_DOOR_WITHOUT_MOUNT_BASELINE, ["widget", "gone"]));

      const violations = lintRestDoorWithoutMount(snapshotOf({ root }));

      expect(violations.map((violation) => violation.policy)).toEqual([
        "rest-door-without-mount-baseline",
      ]);
      expect(violations[0]!.message).toContain('"gone"');
    });

    it("reports an unlisted family under the policy name", () => {
      write(
        DOORS_FILE,
        `export const API_REST_DOORS = [
  { family: "widget", owner: "process", paths: ["/api/widget"] },
];
`,
      );
      write(DOORS_BASELINE, baselineText(REST_DOOR_WITHOUT_MOUNT_BASELINE, ["something-else"]));

      const violations = lintRestDoorWithoutMount(snapshotOf({ root }));

      expect(violations.map((violation) => violation.policy)).toContain("rest-door-without-mount");
      const finding = violations.find((violation) => violation.policy === "rest-door-without-mount");
      expect(finding!.allowed).toBe("Declare the mount on the runtime.");
    });
  });

  it("collects the baseline as rows keyed by family, sorted", () => {
    write(
      DOORS_FILE,
      `export const API_REST_DOORS = [
  { family: "widget", owner: "process", paths: ["/api/widget"] },
  { family: "alpha", owner: "process", paths: ["/api/alpha"] },
];
`,
    );

    const entries = collectRestDoorWithoutMountBaseline({ root });

    expect(entries.map((entry) => entry.key)).toEqual(["alpha", "widget"]);
  });
});

describe("ports and adapters folders", () => {
  describe("given a file under a module's ports or adapters folder", () => {
    /** @scenario A ports/adapters file is refused with the instruction to fold it into repositories or services */
    it("reports the file by its path", () => {
      write("modules/widget/server/src/ports/widget-clock.port.ts", "export type WidgetClock = unknown;\n");
      write(
        "enterprise/modules/billing/server/src/adapters/postgres.billing.adapter.ts",
        "export const adapter = 1;\n",
      );
      write("modules/widget/server/src/services/widget.service.ts", "export const service = 1;\n");

      const findings = collectPortsAndAdaptersFoldersFindings(root);

      expect(findings).toEqual([
        "enterprise/modules/billing/server/src/adapters/postgres.billing.adapter.ts",
        "modules/widget/server/src/ports/widget-clock.port.ts",
      ]);
    });
  });

  describe("given no module carries a ports or adapters folder", () => {
    it("reports nothing", () => {
      write("modules/widget/server/src/services/widget.service.ts", "export const service = 1;\n");
      write("modules/widget/server/src/repositories/widget.repository.ts", "export const repo = 1;\n");

      expect(collectPortsAndAdaptersFoldersFindings(root)).toEqual([]);
    });
  });

  describe("given a baseline", () => {
    it("silences a listed path and refuses a stale entry", () => {
      write("modules/widget/server/src/ports/widget-clock.port.ts", "export type WidgetClock = unknown;\n");
      write(
        PORTS_BASELINE,
        baselineText(PORTS_AND_ADAPTERS_FOLDERS_BASELINE, [
          "modules/widget/server/src/ports/widget-clock.port.ts",
          "modules/widget/server/src/ports/gone.port.ts",
        ]),
      );

      const violations = lintPortsAndAdaptersFolders(snapshotOf({ root }));

      expect(violations.map((violation) => violation.policy)).toEqual([
        "ports-and-adapters-folders-baseline",
      ]);
      expect(violations[0]!.message).toContain("gone.port.ts");
    });
  });

  it("collects the baseline sorted by path", () => {
    write("modules/widget/server/src/ports/b.port.ts", "export type B = unknown;\n");
    write("modules/widget/server/src/adapters/a.adapter.ts", "export const a = 1;\n");

    const entries = collectPortsAndAdaptersFoldersBaseline({ root });

    expect(entries.map((entry) => entry.key)).toEqual([
      "modules/widget/server/src/adapters/a.adapter.ts",
      "modules/widget/server/src/ports/b.port.ts",
    ]);
  });
});

describe("composition root may only shrink", () => {
  const COMPOSITION_ROOT = "apps/api/src/app/api-production.composition.ts";

  describe("given a composition root that grew past its stored budget", () => {
    /** @scenario A composition root past its measured budget is refused with the instruction to add nothing to it */
    it("reports the file with its line count and its budget", () => {
      write(COMPOSITION_ROOT, "export const line = 1;\n".repeat(5));
      write(BUDGET_FILE, JSON.stringify({ version: 0, budgets: { [COMPOSITION_ROOT]: 3 } }));

      const findings = collectCompositionRootBudgetFindings(root);

      expect(findings).toEqual([{ path: COMPOSITION_ROOT, lines: 5, budget: 3 }]);
    });
  });

  describe("given a composition root at or below its stored budget", () => {
    it("reports nothing", () => {
      write(COMPOSITION_ROOT, "export const line = 1;\n".repeat(3));
      write(BUDGET_FILE, JSON.stringify({ version: 0, budgets: { [COMPOSITION_ROOT]: 3 } }));

      expect(collectCompositionRootBudgetFindings(root)).toEqual([]);
    });
  });

  describe("given no budget has ever been checked in", () => {
    it("refuses to compare rather than silently passing", () => {
      write(COMPOSITION_ROOT, "export const line = 1;\n");

      const violations = lintCompositionRootMayOnlyShrink(snapshotOf({ root }));

      expect(violations).toHaveLength(1);
      expect(violations[0]!.message).toContain("must be checked in before it can be compared");
    });
  });

  it("collects a shrunk budget as the smaller of the stored and the measured count", () => {
    write(COMPOSITION_ROOT, "export const line = 1;\n".repeat(2));
    write(BUDGET_FILE, JSON.stringify({ version: 0, budgets: { [COMPOSITION_ROOT]: 9 } }));

    const budget = collectCompositionRootBudget(root);

    expect(budget.budgets[COMPOSITION_ROOT]).toBe(2);
  });
});

describe("mount file is one call", () => {
  const MOUNT_FILE = "apps/api/src/features/widget/widget-rest.mount.ts";

  describe("given a mount file whose exported function is a single return of runtime.mount(...)", () => {
    it("reports nothing", () => {
      write(
        MOUNT_FILE,
        `import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

export function mountWidgetRest(runtime: ApiRestRuntime) {
  return [runtime.mount(widgetRest.router(), () => api)];
}
`,
      );

      expect(collectMountFileIsOneCallFindings(root)).toEqual([]);
    });
  });

  describe("given a mount file with a helper declared at the top level", () => {
    /** @scenario A mount file carrying more than an import and one runtime.mount call is refused */
    it("reports the file as carrying a top-level declaration besides the mount function", () => {
      write(
        MOUNT_FILE,
        `import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

const WIDGET_ID = /^[a-z]+$/;

export function mountWidgetRest(runtime: ApiRestRuntime) {
  return [runtime.mount(widgetRest.router(), () => api)];
}
`,
      );

      const findings = collectMountFileIsOneCallFindings(root);

      expect(findings).toEqual([
        { path: MOUNT_FILE, reason: "carries a top-level declaration besides imports and one exported mount function" },
      ]);
    });
  });

  describe("given a mount file whose exported function does more than return the mount call", () => {
    it("reports the file as not a single return of runtime.mount(...)", () => {
      write(
        MOUNT_FILE,
        `import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

export function mountWidgetRest(runtime: ApiRestRuntime) {
  const onError = () => undefined;
  return [runtime.mount(widgetRest.router(), () => api, { onError })];
}
`,
      );

      const findings = collectMountFileIsOneCallFindings(root);

      expect(findings).toEqual([
        { path: MOUNT_FILE, reason: "its exported function is not a single return of runtime.mount(...)" },
      ]);
    });
  });

  describe("given a baseline", () => {
    it("silences a listed offender and refuses a stale entry", () => {
      write(
        MOUNT_FILE,
        `import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

const WIDGET_ID = /^[a-z]+$/;

export function mountWidgetRest(runtime: ApiRestRuntime) {
  return [runtime.mount(widgetRest.router(), () => api)];
}
`,
      );
      write(
        MOUNT_BASELINE,
        baselineText(MOUNT_FILE_IS_ONE_CALL_BASELINE, [MOUNT_FILE, "apps/api/src/features/gone/gone-rest.mount.ts"]),
      );

      const violations = lintMountFileIsOneCall(snapshotOf({ root }));

      expect(violations.map((violation) => violation.policy)).toEqual([
        "mount-file-is-one-call-baseline",
      ]);
      expect(violations[0]!.message).toContain("gone-rest.mount.ts");
    });
  });

  it("collects the baseline sorted by path", () => {
    write(
      MOUNT_FILE,
      `const WIDGET_ID = /^[a-z]+$/;

export function mountWidgetRest(runtime) {
  return [runtime.mount(widgetRest.router(), () => api)];
}
`,
    );

    const entries = collectMountFileIsOneCallBaseline({ root });

    expect(entries.map((entry) => entry.key)).toEqual([MOUNT_FILE]);
  });
});
