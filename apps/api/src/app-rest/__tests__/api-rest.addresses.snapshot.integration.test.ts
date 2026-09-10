/**
 * The wire, pinned. Every address this process mounts, with the credential kind
 * that answers it, generated from the mounted declarations and compared with
 * the checked-in inventory: a conversion that moves a route, drops a `/api/v1`
 * twin or changes a door is a failing diff a reviewer reads in seconds.
 *
 * Regenerate with `LANGWATCH_WRITE_REST_ADDRESSES=1` on this file's own run,
 * and review the diff line by line before committing it.
 *
 * Spec: specs/server/declarative-process-composition.feature.
 */
import { restAddressInventory, type RestAddress } from "@langwatch/api/rest";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { absenceRecorder, mountRestFamily } from "./support/rest-family.harness.ts";

const INVENTORY = new URL("../api-rest.addresses.json", import.meta.url);

function generated(): RestAddress[] {
  mountRestFamily({ absence: absenceRecorder().report });

  return restAddressInventory();
}

function checkedIn(): RestAddress[] {
  return JSON.parse(readFileSync(INVENTORY, "utf8")) as RestAddress[];
}

describe("given every REST family this process mounts", () => {
  describe("when the address inventory is generated", () => {
    /** @scenario "The wire is pinned across a conversion" */
    it("matches the checked-in inventory, method, path and credential kind", () => {
      const addresses = generated();

      if (process.env.LANGWATCH_WRITE_REST_ADDRESSES === "1") {
        writeFileSync(INVENTORY, `${JSON.stringify(addresses, null, 2)}\n`);
      }

      const pinned = checkedIn();

      if (pinned.length === 0) {
        throw new Error(
          "api-rest.addresses.json is empty: seed it once with " +
            "LANGWATCH_WRITE_REST_ADDRESSES=1 pnpm --filter @langwatch/platform-api test:unit " +
            "src/app-rest/__tests__/api-rest.addresses.snapshot.integration.test.ts",
        );
      }

      expect(addresses).toEqual(pinned);
    });
  });

  describe("when a family is mounted at all", () => {
    it("publishes at least one address", () => {
      expect(generated().length).toBeGreaterThan(0);
    });
  });
});
