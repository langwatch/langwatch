/**
 * @see modules/langy/specs/langy-image-attachments.feature
 */
import { describe, expect, it } from "vitest";

import { langyAttachmentAddressOf, withImageChipsAsNames } from "../langy-attachments.ts";

describe("langyAttachmentAddressOf", () => {
  describe("given a stored image's address", () => {
    it("reads its project, object and decoded file name", () => {
      expect(langyAttachmentAddressOf("/api/files/project_1/storedobject_a/100%25.png")).toEqual({
        projectId: "project_1",
        objectId: "storedobject_a",
        filename: "100%.png",
      });
    });
  });

  describe("given an address that is not a stored image", () => {
    it("answers not_stored for a malformed escape instead of throwing", () => {
      expect(langyAttachmentAddressOf("/api/files/project_1/storedobject_a/100%.png")).toBe(
        "not_stored",
      );
    });

    it("answers not_stored for any other address", () => {
      expect(langyAttachmentAddressOf("https://example.com/a.png")).toBe("not_stored");
    });
  });
});

describe("withImageChipsAsNames", () => {
  /** @scenario A conversation title shows an image by its file name */
  it("reads each chip as its file name", () => {
    expect(withImageChipsAsNames("see [▣ a.png] and [▣ b.png]")).toBe("see a.png and b.png");
  });
});
