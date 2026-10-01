/**
 * Handing the reader a file the browser never fetched.
 * Spec: specs/audit-log/audit-log.feature, specs/components/adaptive-graphics-quality.feature
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downloadUiFile, evaluateFpsSample } from "../facilities.ts";

type Recorded = {
  created: Blob[];
  revoked: string[];
  /** What was true about the anchor at the moment it was clicked. */
  atClick: { href: string; download: string | null; attached: boolean; revoked: number }[];
};

let recorded: Recorded;
let originalCreate: typeof URL.createObjectURL | undefined;
let originalRevoke: typeof URL.revokeObjectURL | undefined;
// Captured as a property descriptor, never as a bare method reference: `click`
// depends on `this` being the actual anchor clicked, so a `.bind()`d copy
// (safe for the two static URL methods above) would restore a version
// permanently bound to the prototype instead of the calling element.
let originalClickDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  recorded = { created: [], revoked: [], atClick: [] };
  originalCreate = URL.createObjectURL.bind(URL);
  originalRevoke = URL.revokeObjectURL.bind(URL);
  originalClickDescriptor = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, "click");

  URL.createObjectURL = vi.fn((blob: Blob) => {
    recorded.created.push(blob);
    return `blob:test/${recorded.created.length}`;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    recorded.revoked.push(url);
  });

  // jsdom would try to navigate to the blob URL, which is neither what a
  // download does nor something it implements. Recording the state at the
  // moment of the click is also the only way to observe the ordering.
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    recorded.atClick.push({
      href: this.getAttribute("href") ?? "",
      download: this.getAttribute("download"),
      attached: document.body.contains(this),
      revoked: recorded.revoked.length,
    });
  };
});

afterEach(() => {
  if (originalCreate) URL.createObjectURL = originalCreate;
  if (originalRevoke) URL.revokeObjectURL = originalRevoke;
  if (originalClickDescriptor) {
    Object.defineProperty(HTMLAnchorElement.prototype, "click", originalClickDescriptor);
  }
  document.body.innerHTML = "";
});

const FILE = {
  fileName: "audit_logs_2026-03-04.csv",
  contents: "Timestamp,Action\n2026-03-04,project.created\n",
  mediaType: "text/csv",
};

describe("given a file a screen decided the contents of", () => {
  describe("when it is handed to the reader", () => {
    /** @scenario An exported report reaches the reader as a named file */
    it("saves it under the name the screen chose", () => {
      downloadUiFile(FILE);

      expect(recorded.atClick).toHaveLength(1);
      expect(recorded.atClick[0]?.download).toBe("audit_logs_2026-03-04.csv");
    });

    /** @scenario An exported report reaches the reader as a named file */
    it("carries the bytes and the media type the screen supplied", async () => {
      downloadUiFile(FILE);

      expect(recorded.created).toHaveLength(1);
      const blob = recorded.created[0]!;
      expect(blob.type).toBe("text/csv");
      expect(await blob.text()).toBe(FILE.contents);
    });

    /**
     * A detached anchor's click does nothing in Chrome, which is a download
     * that silently never happens.
     */
    /** @scenario An exported report reaches the reader as a named file */
    it("clicks the anchor while it is in the document", () => {
      downloadUiFile(FILE);

      expect(recorded.atClick[0]?.attached).toBe(true);
    });

    /**
     * Revoking before the click cancels the save it was racing.
     */
    /** @scenario An exported report reaches the reader as a named file */
    it("revokes the object URL after the click and never before it", () => {
      downloadUiFile(FILE);

      expect(recorded.atClick[0]?.revoked).toBe(0);
      expect(recorded.revoked).toEqual(["blob:test/1"]);
    });

    /** @scenario An exported report reaches the reader as a named file */
    it("leaves nothing behind in the document", () => {
      downloadUiFile(FILE);

      expect(document.body.querySelector("a")).toBeNull();
    });
  });

  describe("when the click itself throws", () => {
    /**
     * A blob that outlives the document is a leak on a page whose whole purpose
     * is repeated exports, so the cleanup runs whatever the click did.
     */
    /** @scenario An exported report reaches the reader as a named file */
    it("still detaches the anchor and revokes the URL", () => {
      HTMLAnchorElement.prototype.click = function click() {
        throw new Error("blocked");
      };

      expect(() => downloadUiFile(FILE)).toThrow("blocked");
      expect(document.body.querySelector("a")).toBeNull();
      expect(recorded.revoked).toEqual(["blob:test/1"]);
    });
  });
});

describe("evaluateFpsSample()", () => {
  describe("given a sample window below the floor", () => {
    /** @scenario A frame rate below the floor is reported as struggling */
    it("reports the device as struggling", () => {
      expect(evaluateFpsSample({ frames: 40, elapsedMs: 1500, minFps: 50 })).toBe(true);
    });
  });

  describe("given a sample window at or above the floor", () => {
    /** @scenario A frame rate at or above the floor is reported as smooth */
    it("reports the device as smooth", () => {
      expect(evaluateFpsSample({ frames: 90, elapsedMs: 1500, minFps: 50 })).toBe(false);
    });
  });

  describe("given a sample window with no observed frames", () => {
    /** @scenario A sample window with no observed frames is reported as struggling */
    it("reports the device as struggling", () => {
      expect(evaluateFpsSample({ frames: 0, elapsedMs: 1500, minFps: 50 })).toBe(true);
    });
  });
});
