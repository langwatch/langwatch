import { describe, expect, it } from "vitest";

import { savedSessionMessage } from "../sign-in-security.ts";

describe("savedSessionMessage", () => {
  it("says only that it saved when no session was ended", () => {
    expect(savedSessionMessage(0)).toBe("Saved.");
  });

  it("names how many sessions the new window ended", () => {
    expect(savedSessionMessage(1)).toBe(
      "Saved. 1 session already idle past the new limit has been signed out.",
    );
    expect(savedSessionMessage(3)).toBe(
      "Saved. 3 sessions already idle past the new limit have been signed out.",
    );
  });
});
