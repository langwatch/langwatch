/** @see ../../../specs/stored-objects.feature */
import { describe, expect, it } from "vitest";

import { storedObjectIdentitySchema } from "../index.ts";

describe("storedObjectIdentitySchema", () => {
  /** @scenario "A project id that starts with a dash or an underscore is a valid stored-object scope" */
  it.each(["-Kx81fRk2QJ7aYc0Ab3Zt", "_q9Wm2LpR4sTn8VbXc1Ed", "project_Ab3Zt9Kx81fRk2QJ7aYc0"])(
    "accepts the project id %s",
    (projectId) => {
      expect(storedObjectIdentitySchema.validate({ projectId, id: "so_abc" })).toBe(true);
    },
  );

  /** @scenario "A project id that starts with a dash or an underscore is a valid stored-object scope" */
  it.each([".hidden", "..", "a/b", "", "a b"])("refuses the project id %j", (projectId) => {
    expect(storedObjectIdentitySchema.validate({ projectId, id: "so_abc" })).toBe(false);
  });
});
