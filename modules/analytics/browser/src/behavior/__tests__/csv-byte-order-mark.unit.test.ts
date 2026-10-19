/**
 * @vitest-environment jsdom
 * The shared CSV writer marks a file as UTF-8 for a spreadsheet only when its caller asks, so
 * every other export keeps the bytes it had.
 * @see modules/analytics/specs/dashboard-widget-export.feature
 */

import { downloadCsv } from "@langwatch/csv/download";
import { beforeAll, describe, expect, it, vi } from "vitest";

let lastBlob: Blob | undefined;

beforeAll(() => {
  window.URL.createObjectURL = vi.fn((blob: Blob) => {
    lastBlob = blob;
    return "blob:test";
  });
  window.URL.revokeObjectURL = vi.fn();
});

/** The bytes actually written to the file, read back out of the blob. */
async function writtenBytes({ byteOrderMark }: { byteOrderMark?: boolean }) {
  lastBlob = undefined;
  downloadCsv({
    fields: ["Model"],
    rows: [["modèle"]],
    fileName: "f.csv",
    ...(byteOrderMark === undefined ? {} : { byteOrderMark }),
  });
  return [...new Uint8Array(await lastBlob!.arrayBuffer())];
}

const PLAIN = [...new TextEncoder().encode("Model\r\nmodèle")];

describe("downloadCsv", () => {
  describe("when the caller asks for a byte order mark", () => {
    /** @scenario "A file is written with a byte order mark only when the caller asks" */
    it("starts the file with the UTF-8 mark, then the same bytes", async () => {
      expect(await writtenBytes({ byteOrderMark: true })).toEqual([0xef, 0xbb, 0xbf, ...PLAIN]);
    });
  });

  describe("when the caller does not ask", () => {
    /** @scenario "A file is written with a byte order mark only when the caller asks" */
    it("writes the bytes it wrote before", async () => {
      expect(await writtenBytes({})).toEqual(PLAIN);
    });
  });
});
