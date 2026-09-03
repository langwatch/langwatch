/**
 * What the API Key host answers, and — the parts worth a test — what it writes.
 *
 * Most of the port is a value object over readings the provider already made, so
 * the assertions below concentrate on the three methods that COMPOSE something,
 * and each of them fails silently when it is wrong:
 *
 *  - `copyToClipboard` must not claim success for a write the browser refused.
 *    A reader told "copied" for a credential that never reached the clipboard
 *    finds out when their SDK rejects it.
 *  - `recordLeadSourceIfAbsent` is FIRST-TOUCH. Overwriting would attribute a
 *    signup that came from a campaign to the CLI, and storage that throws
 *    outright must not take the page down with it.
 *  - `openPlatformDrawer` writes the same address `openDrawer` does, including
 *    its clearing of every stale `drawer.*` key — a leftover one opens an editor
 *    on the row the reader looked at before this one.
 *
 * Spec: specs/ai-governance/cli-onboarding/login-unified.feature
 */

import { describe, expect, it, vi } from "vitest";
import {
  ATTRIBUTION_STORAGE_PREFIX,
  DRAWER_OPEN_PARAM,
  LEAD_SOURCE_FIELD,
  UiApiKeyHost,
} from "../src/features/api-key/behavior/api-key-host.adapter";
import type { UiBrowserStorage } from "../src/behavior/ui-browser-storage";

const LEAD_SOURCE_KEY = `${ATTRIBUTION_STORAGE_PREFIX}${LEAD_SOURCE_FIELD}`;

function fakeStorage(initial: Record<string, string> = {}): UiBrowserStorage & {
  written: Record<string, string>;
} {
  const values = { ...initial };
  return {
    written: values,
    get length() {
      return Object.keys(values).length;
    },
    key: (index: number) => Object.keys(values)[index] ?? null,
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value;
    },
    removeItem: (key: string) => {
      delete values[key];
    },
  };
}

function hostWith(
  options: {
    query?: Record<string, string | undefined>;
    storage?: UiBrowserStorage;
    writeClipboard?: (text: string) => Promise<void>;
  } = {},
) {
  const setQuery = vi.fn();
  const succeeded = vi.fn();
  const failed = vi.fn();
  const host = UiApiKeyHost.create(
    {
      scope: {
        organizationId: "org_1",
        organizationName: "ACME",
        teamId: "team_1",
        projectId: "project_1",
        projectName: "Web App",
        projectSlug: "web-app",
        projectApiKey: void 0,
      },
      availableScopes: { organization: null, teams: [], projects: [] },
      organizations: void 0,
      currentUser: { id: "user_1" },
      sessionStatus: "authenticated",
      apiEndpoint: "https://app.langwatch.ai",
      route: { params: {}, query: options.query ?? {}, fragment: "" },
    },
    {
      hasPermission: (permission) => permission === "project:manage",
      setQuery,
      replace: vi.fn(),
      navigate: vi.fn(),
      succeeded,
      failed,
      writeClipboard: options.writeClipboard ?? (() => Promise.resolve()),
      visitStorage: options.storage ?? fakeStorage(),
      lookupDeviceCode: vi.fn(),
      approveDeviceCode: vi.fn(),
      denyDeviceCode: vi.fn(),
    },
  );
  return { host, setQuery, succeeded, failed };
}

describe("given a screen copies a credential", () => {
  describe("when the write lands", () => {
    it("says what was copied, in the screen's own words", async () => {
      const { host, succeeded, failed } = hostWith();
      const ok = await host.copyToClipboard({
        text: "sk-lw-secret",
        succeeded: { title: "API key copied to clipboard" },
      });
      expect(ok).toBe(true);
      expect(succeeded).toHaveBeenCalledWith({ title: "API key copied to clipboard" });
      expect(failed).not.toHaveBeenCalled();
    });
  });

  describe("when the browser refuses the write", () => {
    it("answers false and says so, rather than claiming a copy that did not happen", async () => {
      const refusal = new Error("Document is not focused");
      const { host, succeeded, failed } = hostWith({
        writeClipboard: () => Promise.reject(refusal),
      });
      const ok = await host.copyToClipboard({
        text: "sk-lw-secret",
        succeeded: { title: "API key copied to clipboard" },
      });
      expect(ok).toBe(false);
      expect(succeeded).not.toHaveBeenCalled();
      expect(failed).toHaveBeenCalledWith({
        error: refusal,
        fallbackTitle: "Failed to copy",
        description: "Couldn't copy. Please try again.",
      });
    });
  });
});

describe("given the CLI stamps its acquisition source", () => {
  describe("when nothing has claimed it yet", () => {
    it("writes it under the key the signup reader looks for", () => {
      const storage = fakeStorage();
      const { host } = hostWith({ storage });
      host.recordLeadSourceIfAbsent("cli");
      // The prefix and field are `platform/app/src/utils/attribution.ts`'s, and
      // this is the pin that makes a rename on either side a failing test rather
      // than a lead source that silently stops arriving.
      expect(LEAD_SOURCE_KEY).toBe("lw_attrib.leadSource");
      expect(storage.written[LEAD_SOURCE_KEY]).toBe("cli");
    });
  });

  describe("when the reader already arrived through a campaign", () => {
    it("leaves their real source alone", () => {
      const storage = fakeStorage({ [LEAD_SOURCE_KEY]: "launch-week" });
      const { host } = hostWith({ storage });
      host.recordLeadSourceIfAbsent("cli");
      expect(storage.written[LEAD_SOURCE_KEY]).toBe("launch-week");
    });
  });

  describe("when the browser blocks site data outright", () => {
    it("swallows the refusal, because attribution is a nicety and the page is not", () => {
      const throwing: UiBrowserStorage = {
        get length(): number {
          throw new Error("blocked");
        },
        key: () => {
          throw new Error("blocked");
        },
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      };
      const { host } = hostWith({ storage: throwing });
      expect(() => host.recordLeadSourceIfAbsent("cli")).not.toThrow();
    });
  });
});

describe("given a screen addresses the create-project drawer", () => {
  describe("when nothing else is open", () => {
    it("writes the address the rest of the product produces for it", () => {
      const { host, setQuery } = hostWith();
      host.openPlatformDrawer({
        drawer: "createProject",
        params: { organizationId: "org_1" },
      });
      expect(setQuery).toHaveBeenCalledWith({
        [DRAWER_OPEN_PARAM]: "createProject",
        "drawer.organizationId": "org_1",
      });
    });
  });

  describe("when another drawer left its parameters behind", () => {
    it("drops every one of them and keeps everything else", () => {
      const { host, setQuery } = hostWith({
        query: {
          [DRAWER_OPEN_PARAM]: "llmModelCost",
          "drawer.id": "cost_9",
          scope: "TEAM:team_1",
        },
      });
      host.openPlatformDrawer({ drawer: "createProject" });
      expect(setQuery).toHaveBeenCalledWith({
        scope: "TEAM:team_1",
        [DRAWER_OPEN_PARAM]: "createProject",
      });
    });

    it("leaves out a parameter with no value rather than writing undefined", () => {
      const { host, setQuery } = hostWith();
      host.openPlatformDrawer({
        drawer: "createProject",
        params: { organizationId: void 0 },
      });
      expect(setQuery).toHaveBeenCalledWith({ [DRAWER_OPEN_PARAM]: "createProject" });
    });
  });
});
