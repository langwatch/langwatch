/**
 * @vitest-environment node
 *
 * The grants ledger writes one PLATFORM aggregate whose tenant id names no
 * customer (ADR-092). Routing has to recognise that id, and it declares its
 * own copy rather than importing `@langwatch/authz-server/migration`, which
 * would pull that entry and `node:crypto` into every server process. Two
 * copies of a string are only safe while something fails when they diverge.
 */
import { PLATFORM_AUTHZ_TENANT_ID } from "@langwatch/authz-server/migration";
import { describe, expect, it } from "vitest";
import { PLATFORM_TENANT_ID } from "../clickhouseClient";

describe("given the platform tenant is named in two packages", () => {
  describe("when routing compares its id to the ledger's", () => {
    it("holds the same id on both sides", () => {
      expect(PLATFORM_TENANT_ID).toBe(PLATFORM_AUTHZ_TENANT_ID);
    });
  });
});
