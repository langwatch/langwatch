import { describe, expect, it } from "vitest";
import {
  attachmentDisplayName,
  isDatasetAttachmentRef,
  isImageAttachmentRef,
  parseDatasetAttachmentRef,
} from "../attachment-ref";

describe("dataset attachment references", () => {
  describe("given a reference to a file stored in LangWatch", () => {
    it("recognises it", () => {
      expect(
        isDatasetAttachmentRef("/api/files/project-1/so_abc/report.pdf"),
      ).toBe(true);
      expect(isDatasetAttachmentRef("/api/files/project-1/so_abc")).toBe(true);
    });

    it("reads the project, the object and the file name out of it", () => {
      expect(
        parseDatasetAttachmentRef("/api/files/project-1/so_abc/report.pdf"),
      ).toEqual({
        projectId: "project-1",
        objectId: "so_abc",
        name: "report.pdf",
      });
    });

    it("reads a reference that carries no file name", () => {
      expect(parseDatasetAttachmentRef("/api/files/project-1/so_abc")).toEqual({
        projectId: "project-1",
        objectId: "so_abc",
      });
    });

    it("ignores a query string and a fragment", () => {
      expect(
        parseDatasetAttachmentRef("/api/files/p/so_abc/report.pdf?v=2#top"),
      ).toEqual({ projectId: "p", objectId: "so_abc", name: "report.pdf" });
    });
  });

  describe("given a value that is not a stored reference", () => {
    it("refuses a relative step", () => {
      expect(isDatasetAttachmentRef("/api/files/p/../../etc/passwd")).toBe(
        false,
      );
      expect(
        parseDatasetAttachmentRef("/api/files/p/../../etc/passwd"),
      ).toBeNull();
    });

    it("refuses an address on another site and a data URL", () => {
      expect(isDatasetAttachmentRef("https://example.com/a.png")).toBe(false);
      expect(isDatasetAttachmentRef("data:image/png;base64,AAAA")).toBe(false);
    });

    it("refuses a reference that names no object", () => {
      expect(parseDatasetAttachmentRef("/api/files/project-1")).toBeNull();
    });
  });

  describe("given a cell value to label", () => {
    /** @scenario "A cell shows the name of the file it holds" */
    it("shows the file name of a stored file", () => {
      expect(
        attachmentDisplayName("/api/files/p/so_abc/quarter-report.pdf"),
      ).toBe("quarter-report.pdf");
    });

    it("decodes an escaped file name", () => {
      expect(
        attachmentDisplayName("/api/files/p/so_abc/quarter%20report.pdf"),
      ).toBe("quarter report.pdf");
    });

    it("shows the last part of an address on another site", () => {
      expect(attachmentDisplayName("https://example.com/files/a.png")).toBe(
        "a.png",
      );
    });

    it("shows the host when the address has no path", () => {
      expect(attachmentDisplayName("https://example.com/")).toBe("example.com");
    });

    it("shows a plain word for a value that carries the bytes inline", () => {
      expect(attachmentDisplayName("data:image/png;base64,AAAA")).toBe("file");
    });

    it("shows a plain word for an empty value", () => {
      expect(attachmentDisplayName("   ")).toBe("file");
    });
  });

  describe("given a stored reference", () => {
    describe("when the surface has no column type behind the value", () => {
      /** @scenario "A stored reference is drawn as a picture only when it names one" */
      it.each([
        "/api/files/p/so_abc/shot.png",
        "/api/files/p/so_abc/shot.JPEG",
        "/api/files/p/so_abc/holiday%20photo.webp",
      ])("reads %s as a picture", (value) => {
        expect(isImageAttachmentRef(value)).toBe(true);
      });

      /** @scenario "A stored reference is drawn as a picture only when it names one" */
      it.each([
        "/api/files/p/so_abc/quarter.pdf",
        "/api/files/p/so_abc/call.mp3",
        "/api/files/p/so_abc",
        "https://example.com/shot.png",
        "data:image/png;base64,AAAA",
      ])("does not read %s as a picture", (value) => {
        expect(isImageAttachmentRef(value)).toBe(false);
      });
    });
  });
});
