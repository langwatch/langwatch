/**
 * The two grants the Ops pages sit behind, read through the same access decision
 * the shell's page guard makes. Spec: modules/ops/specs/admin.feature
 */
import { resolveUiPageAccess } from "@langwatch/browser/page-guard";
import { describe, expect, it } from "vitest";

import { opsWeb } from "../ops.web.ts";

const screens = Object.entries(opsWeb.installation.screens).filter(([page]) =>
  page.startsWith("pages/ops/"),
);
const WORKSPACE_PAGE = "pages/ops/index";
const BACK_OFFICE_PAGE = "pages/ops/users";

function open({ page, grants }: { page: string; grants: readonly string[] }) {
  const screen = opsWeb.installation.screens[page];
  return resolveUiPageAccess({
    ...(screen?.requires === void 0 ? {} : { permission: screen.requires }),
    featureFlag: () => true,
    hasPermission: (grant) => grants.includes(grant),
    isSettled: () => true,
  });
}

describe("given the pages of the Ops workspace and the Back office", () => {
  /** @scenario "An operator sees the Ops workspace" */
  it("opens every workspace page for a reader holding the operator view grant", () => {
    const workspace = screens.filter(([, screen]) => screen.requires === "ops:view");

    expect(workspace.length).toBeGreaterThan(0);
    for (const [page] of workspace) {
      expect(open({ page, grants: ["ops:view"] })).toEqual({ kind: "open" });
    }
  });

  /** @scenario "A reader without the operator grant is refused and told which grant" */
  it("refuses a reader holding no operator grant and names the grant they lack", () => {
    expect(open({ page: WORKSPACE_PAGE, grants: [] })).toEqual({
      kind: "forbidden",
      permission: "ops:view",
    });
    expect(open({ page: BACK_OFFICE_PAGE, grants: [] })).toEqual({
      kind: "forbidden",
      permission: "ops:manage",
    });
  });

  /** @scenario "The Back office stays narrower than the workspace" */
  it("refuses every Back office page to a reader holding view and not manage", () => {
    const backOffice = screens.filter(([, screen]) => screen.requires === "ops:manage");

    expect(open({ page: WORKSPACE_PAGE, grants: ["ops:view"] })).toEqual({ kind: "open" });
    expect(backOffice.length).toBeGreaterThan(0);
    for (const [page] of backOffice) {
      expect(open({ page, grants: ["ops:view"] })).toEqual({
        kind: "forbidden",
        permission: "ops:manage",
      });
    }
  });

  it("puts every Ops page behind one of the two grants", () => {
    for (const [page, screen] of screens) {
      expect({ page, requires: screen.requires }).toEqual({
        page,
        requires: expect.stringMatching(/^ops:(view|manage)$/),
      });
    }
  });
});
