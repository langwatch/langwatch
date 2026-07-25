/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { errorDisplayMessage } from "../trpcError";

describe("errorDisplayMessage", () => {
  describe("when the server authored prose in meta.message", () => {
    it("shows that prose ahead of the wire message", () => {
      expect(
        errorDisplayMessage({
          message: "query_memory_exceeded",
          data: {
            error: {
              code: "query_memory_exceeded",
              meta: { message: "That query needed too much memory." },
            },
          },
        }),
      ).toBe("That query needed too much memory.");
    });
  });

  describe("when a plain TRPCError carries copy the procedure authored", () => {
    it("shows the wire message", () => {
      expect(
        errorDisplayMessage({
          message: "Choose a project first",
          data: { code: "BAD_REQUEST", error: null },
        }),
      ).toBe("Choose a project first");
    });
  });

  describe("when a handled error carries no prose at all", () => {
    it("falls back to the stable code rather than an empty toast", () => {
      // The wire message IS the code here, so this is what the user sees until
      // an explainer entry or `meta.message` exists for it.
      expect(
        errorDisplayMessage({
          message: "langy_credential_resolution",
          data: { error: { code: "langy_credential_resolution", meta: {} } },
        }),
      ).toBe("langy_credential_resolution");
    });

    it("uses the code when the wire message is missing entirely", () => {
      expect(
        errorDisplayMessage({
          data: { error: { code: "dataset_not_found", meta: {} } },
        }),
      ).toBe("dataset_not_found");
    });
  });

  describe("when given something that is not an error shape", () => {
    it("never renders empty", () => {
      expect(errorDisplayMessage(null)).toBe("An unknown error occurred");
      expect(errorDisplayMessage({})).toBe("An unknown error occurred");
    });
  });
});
