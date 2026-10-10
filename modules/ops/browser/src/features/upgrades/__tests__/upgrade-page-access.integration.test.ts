/**
 * The Upgrades pages behind the operator view grant, read through the same access decision the
 * shell's page guard makes. Spec: modules/ops/specs/upgrades.feature
 */
import { resolveUiPageAccess } from "@langwatch/browser/page-guard";
import { describe, expect, it } from "vitest";

import { opsWeb } from "../../../ops.web.ts";

const UPGRADE_PAGES = [
  "pages/ops/upgrades",
  "pages/ops/upgrades/releases/[release]",
  "pages/ops/upgrades/runs/[runId]",
] as const;

function open({ page, grants }: { page: string; grants: readonly string[] }) {
  const screen = opsWeb.installation.screens[page];
  return resolveUiPageAccess({
    ...(screen?.requires === void 0 ? {} : { permission: screen.requires }),
    featureFlag: () => true,
    hasPermission: (grant) => grants.includes(grant),
    isSettled: () => true,
  });
}

describe("given the Upgrades pages", () => {
  /** @scenario "A view-only operator reads every upgrade screen" */
  it("opens every page for a reader holding the view grant and not the manage grant", () => {
    for (const page of UPGRADE_PAGES) {
      expect(opsWeb.installation.screens[page]).toBeDefined();
      expect(open({ page, grants: ["ops:view"] })).toEqual({ kind: "open" });
    }
  });

  /** @scenario "A reader without the operator grant is refused every upgrade screen by the router" */
  it("refuses every page to a reader holding no operator grant and names ops:view", () => {
    for (const page of UPGRADE_PAGES) {
      expect(open({ page, grants: [] })).toEqual({ kind: "forbidden", permission: "ops:view" });
    }
  });

  /** @scenario "The Upgrades page opens once its grant read settles, even when no feature flag answers" */
  it("opens once the grant read settles even when no feature flag ever answered", () => {
    for (const page of UPGRADE_PAGES) {
      const screen = opsWeb.installation.screens[page];
      const access = resolveUiPageAccess({
        ...(screen?.requires === void 0 ? {} : { permission: screen.requires }),
        featureFlag: () => void 0,
        hasPermission: (grant) => grant === "ops:view",
        isSettled: () => true,
      });
      expect(access).toEqual({ kind: "open" });
    }
  });
});
