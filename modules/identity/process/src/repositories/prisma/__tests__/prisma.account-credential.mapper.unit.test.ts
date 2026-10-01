import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  toColumnValue,
  toCredentialColumns,
  toInstant,
} from "../prisma.account-credential.mapper.ts";

const EXPIRY_MS = 1_800_000_000_000;
const EXPIRY = Temporal.Instant.fromEpochMilliseconds(EXPIRY_MS);

describe("the account credential mapper", () => {
  describe("when a secret patch is written", () => {
    it("stores an expiry instant as the Date its DateTime column holds", () => {
      expect(toCredentialColumns({ accessTokenExpiresAt: EXPIRY })).toEqual({
        accessTokenExpiresAt: new Date(EXPIRY_MS),
      });
    });

    it("writes only the fields the patch names, clearing a null one", () => {
      expect(toCredentialColumns({ accessToken: "at", refreshTokenExpiresAt: null })).toEqual({
        accessToken: "at",
        refreshTokenExpiresAt: null,
      });
    });

    it("leaves a string secret as it is", () => {
      expect(toColumnValue("rt")).toBe("rt");
    });
  });

  describe("when a stored expiry is read", () => {
    it("answers the instant the column held", () => {
      expect(toInstant(new Date(EXPIRY_MS))?.epochMilliseconds).toBe(EXPIRY_MS);
    });

    it("answers none for an empty column", () => {
      expect(toInstant(null)).toBeNull();
    });
  });
});
