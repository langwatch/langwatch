import { describe, expect, it } from "vitest";

import { parseStoredObjectFileReference } from "../stored-object-file-route";

describe("parseStoredObjectFileReference", () => {
  describe("when the reference names a project, an id and a file", () => {
    it("decodes the file name", () => {
      expect(parseStoredObjectFileReference("/api/files/project_1/so_1/my%20file.png")).toEqual({
        projectId: "project_1",
        storedObjectId: "so_1",
        filename: "my file.png",
      });
    });
  });

  describe("when the file name carries a malformed escape", () => {
    it("drops the file name instead of throwing", () => {
      expect(parseStoredObjectFileReference("/api/files/project_1/so_1/bad%ZZ.png")).toEqual({
        projectId: "project_1",
        storedObjectId: "so_1",
        filename: undefined,
      });
    });

    it("drops a malformed filename query the same way", () => {
      expect(parseStoredObjectFileReference("/api/files/so_1?filename=%E0%A4%A")).toEqual({
        projectId: undefined,
        storedObjectId: "so_1",
        filename: undefined,
      });
    });
  });

  describe("when the reference is not a files address", () => {
    it("returns undefined", () => {
      expect(parseStoredObjectFileReference("https://example.com/a.png")).toBeUndefined();
    });
  });
});
