import { describe, expect, it } from "vitest";

import {
  helpGroupsFor,
  type ShortcutGuardContext,
  type ShortcutContext,
  TRACE_DRAWER_HELP_GROUPS,
  TRACE_DRAWER_SHORTCUTS,
} from "../trace-drawer-shortcut-table.ts";

const agents = TRACE_DRAWER_SHORTCUTS.find((entry) => entry.id === "agents");
const contextWith = (showsAgents: boolean) => ({ showsAgents }) as ShortcutContext;
const helpLabels = (groups: typeof TRACE_DRAWER_HELP_GROUPS) =>
  groups.flatMap((group) => group.items.map((item) => item.label));

describe("the Agents shortcut", () => {
  /** @scenario "Shortcut 5 opens the Agents tab only when the tab shows" */
  it("runs only when the trace shows the Agents tab", () => {
    expect(agents?.matchKeys).toEqual(["5"]);
    expect(agents?.guard?.(contextWith(false))).toBe(false);
    expect(agents?.guard?.(contextWith(true))).toBe(true);
  });

  /** @scenario "Shortcut 5 opens the Agents tab only when the tab shows" */
  it("leaves Agents out of the help when the tab is hidden", () => {
    expect(helpLabels(TRACE_DRAWER_HELP_GROUPS)).toContain("Agents");
    const context = (showsAgents: boolean): ShortcutGuardContext => ({
      trace: { serviceName: "api", origin: "application" } as ShortcutGuardContext["trace"],
      spanTree: [],
      canGoBack: false,
      showsAgents,
    });
    const help = (showsAgents: boolean) =>
      helpLabels(
        helpGroupsFor({ groups: TRACE_DRAWER_HELP_GROUPS, context: context(showsAgents) }),
      );
    expect(help(false)).not.toContain("Agents");
    expect(help(true)).toContain("Agents");
  });
});
