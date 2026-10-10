/**
 * Handing the reader a file the browser never fetched, through the real DOM.
 * Spec: specs/audit-log/audit-log.feature
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downloadInBrowser } from "../browser-download.ts";

const FILE = {
  fileName: "audit_logs_2026-03-04.csv",
  contents: "Timestamp,Action\n2026-03-04,project.created\n",
  mediaType: "text/csv",
};

let revoked: string[];
let atClick: { download: string; attached: boolean; revokedSoFar: number }[];
const originalCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
const originalClick = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, "click");

beforeEach(() => {
  revoked = [];
  atClick = [];
  URL.createObjectURL = vi.fn(() => "blob:test/1");
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    atClick.push({
      download: this.download,
      attached: document.body.contains(this),
      revokedSoFar: revoked.length,
    });
  };
});

afterEach(() => {
  if (originalCreate) Object.defineProperty(URL, "createObjectURL", originalCreate);
  if (originalRevoke) Object.defineProperty(URL, "revokeObjectURL", originalRevoke);
  if (originalClick) Object.defineProperty(HTMLAnchorElement.prototype, "click", originalClick);
  document.body.innerHTML = "";
});

describe("given a report the screen built", () => {
  describe("when it is handed to the reader", () => {
    /** @scenario An exported report reaches the reader as a named file */
    it("saves it under the chosen name and releases the URL only after the click", () => {
      downloadInBrowser(FILE);

      expect(atClick).toEqual([
        { download: "audit_logs_2026-03-04.csv", attached: true, revokedSoFar: 0 },
      ]);
      expect(revoked).toEqual(["blob:test/1"]);
      expect(document.body.querySelector("a")).toBeNull();
    });
  });
});
