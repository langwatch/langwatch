/**
 * `recordLeadSourceIfAbsent` is FIRST-TOUCH. Overwriting would attribute a
 * signup that came from a campaign to the CLI, and storage that throws
 * outright must not take the page down with it.
 *
 * Spec: specs/ai-governance/cli-onboarding/login-unified.feature
 */

import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_STORAGE_PREFIX,
  LEAD_SOURCE_FIELD,
  recordLeadSourceIfAbsent,
} from "../src/features/api-key/behavior/api-key-lead-source";
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

describe("given the CLI stamps its acquisition source", () => {
  describe("when nothing has claimed it yet", () => {
    it("writes it under the key the signup reader looks for", () => {
      const storage = fakeStorage();
      recordLeadSourceIfAbsent({ storage, source: "cli" });
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
      recordLeadSourceIfAbsent({ storage, source: "cli" });
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
      expect(() => recordLeadSourceIfAbsent({ storage: throwing, source: "cli" })).not.toThrow();
    });
  });
});
