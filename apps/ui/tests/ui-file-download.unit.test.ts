/**
 * @vitest-environment jsdom
 *
 * Handing the reader a file the browser never fetched.
 *
 * The other half of a report a feature package decided the contents of. It is
 * four browser globals in a sequence, and every one of the three ways to get
 * the sequence wrong is silent: a detached anchor's click does nothing, a URL
 * revoked before the click cancels the save it was racing, and a URL never
 * revoked leaks a blob for the life of a document whose whole purpose is
 * repeated exports.
 *
 * `@langwatch/organization-web`'s own suite asserts WHAT the file says; this one
 * asserts that it arrives.
 *
 * Spec: specs/audit-log/audit-log.feature
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadUiFile } from "../src/behavior/ui-file-download";

type Recorded = {
  created: Blob[];
  revoked: string[];
  /** What was true about the anchor at the moment it was clicked. */
  atClick: Array<{ href: string; download: string | null; attached: boolean; revoked: number }>;
};

let recorded: Recorded;
let originalCreate: typeof URL.createObjectURL | undefined;
let originalRevoke: typeof URL.revokeObjectURL | undefined;
let originalClick: () => void;

beforeEach(() => {
  recorded = { created: [], revoked: [], atClick: [] };
  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  originalClick = HTMLAnchorElement.prototype.click;

  URL.createObjectURL = vi.fn((blob: Blob) => {
    recorded.created.push(blob);
    return `blob:test/${recorded.created.length}`;
  }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn((url: string) => {
    recorded.revoked.push(url);
  }) as unknown as typeof URL.revokeObjectURL;

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
  HTMLAnchorElement.prototype.click = originalClick;
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
