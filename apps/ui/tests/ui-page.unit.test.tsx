/**
 * @vitest-environment jsdom
 *
 * The one page helper every route file composes through. What it pins is the
 * wrapping order the route docblocks used to defend one by one: host
 * outermost, guard innermost around the screen — and that a key with neither
 * a grant nor a flag mounts no guard at all.
 *
 * There is no settings-layout layer in this helper. `NavigationShell` draws
 * the settings sidebar for every matched `/settings` or `/ops` address on
 * its own (`resolveShellRoute`'s `isSettingsRoute` is a path test, not a
 * per-page opt-in); a second, page-level settings layout used to wrap the
 * same pages in a duplicate sidebar. See
 * packages/navigation/web/src/ui/sections/__tests__/settings-shell.integration.test.tsx
 * for the one sidebar this composition now relies on.
 *
 * Spec: specs/ui/ui-page-composition.feature
 */

import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { uiPage, withHost } from "../src/ui/sections/ui-page";

function Screen() {
  return <div>the screen</div>;
}

function TestHost({ children }: { children: ReactNode }) {
  return <section>{children}</section>;
}

const screen = async () => ({ default: Screen });

describe("uiPage", () => {
  describe("when a host and a grant are both asked for", () => {
    /** @scenario The host sits outside the guard */
    it("mounts host › guard › screen", async () => {
      const page = await uiPage({
        screen,
        host: TestHost,
        permission: "secrets:manage",
      })();
      expect(page.default.displayName).toBe("withHost(TestHost, withUiPageGuard(Screen))");
    });
  });

  describe("when only a host is asked for", () => {
    /** @scenario A key with neither grant nor flag mounts no guard */
    it("wraps the screen in the host and nothing else", async () => {
      const page = await uiPage({ screen, host: TestHost })();
      expect(page.default.displayName).toBe("withHost(TestHost, Screen)");
    });
  });

  describe("when a flag is the only policy", () => {
    /** @scenario A flag alone still mounts the guard */
    it("mounts the guard around the screen", async () => {
      const page = await uiPage({ screen, flags: ["release_x"] })();
      expect(page.default.displayName).toBe("withUiPageGuard(Screen)");
    });
  });

  describe("when nothing but the screen is asked for", () => {
    it("hands the screen back unwrapped", async () => {
      const page = await uiPage({ screen })();
      expect(page.default).toBe(Screen);
    });
  });

  describe("withHost", () => {
    it("names both halves in its displayName", () => {
      expect(withHost(TestHost, Screen).displayName).toBe("withHost(TestHost, Screen)");
    });
  });
});
