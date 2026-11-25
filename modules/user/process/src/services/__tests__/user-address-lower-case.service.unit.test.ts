/**
 * @vitest-environment node
 * The `user:lower-case-stored-addresses` step over user's memory twin: lower-cases every stored
 * address, leaves a case-only duplicate as it is and reports it, and finds nothing on a second
 * run.
 * @see modules/user/specs/user.feature
 */
import { InMemoryProcessStore } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { MemoryUserRepositories } from "../../repositories/memory/memory.user.repositories.ts";
import {
  UserAddressLowerCaseService,
  type UserAddressLowerCaseReport,
} from "../user-address-lower-case.service.ts";

function storedAccounts() {
  return MemoryUserRepositories.create({ processStore: InMemoryProcessStore.createForTesting() })
    .users;
}

async function runStep({ users }: { users: ReturnType<typeof storedAccounts> }) {
  const saved: UserAddressLowerCaseReport[] = [];
  const report = await UserAddressLowerCaseService.create({ users }).lowerCaseStored({
    dryRun: false,
    signal: new AbortController().signal,
    resumeFrom: null,
    onPageDone: async ({ report: progress }) => void saved.push(progress),
  });
  return { report, saved };
}

describe("the address step", () => {
  describe("given accounts stored with capitals and accounts already lower-cased", () => {
    /** @scenario "The address step lower-cases every stored address" */
    it("lower-cases each capitalised address, and the lower-cased lookup then finds it", async () => {
      const users = storedAccounts();
      const ada = await users.create({ name: "Ada", email: "Ada@Example.com" });
      const grace = await users.create({ name: "Grace", email: "grace@example.com" });

      const { report, saved } = await runStep({ users });

      expect(report).toEqual({ afterId: ada.id, lowerCased: 1, clashed: 0, clashes: [] });
      expect(saved).toEqual([report]);
      await expect(users.findByEmail("ada@example.com")).resolves.toMatchObject([{ id: ada.id }]);
      await expect(users.findById(grace.id)).resolves.toMatchObject({
        email: "grace@example.com",
      });
    });
  });

  describe("given accounts whose addresses differ only in case", () => {
    /** @scenario "A case-only duplicate is left as it is and reported" */
    it("leaves each one as it is and lists it in the report, the lower-cased holder untouched", async () => {
      const users = storedAccounts();
      const lowered = await users.create({ name: "Eve", email: "eve@example.com" });
      const capitals = await users.create({ name: "Eve", email: "Eve@Example.com" });
      const shouting = await users.create({ name: "Eve", email: "EVE@example.com" });

      const { report } = await runStep({ users });

      expect(report).toMatchObject({ lowerCased: 0, clashed: 2 });
      expect(report.clashes.toSorted((x, y) => x.userId.localeCompare(y.userId))).toEqual(
        [
          { userId: capitals.id, address: "Eve@Example.com" },
          { userId: shouting.id, address: "EVE@example.com" },
        ].toSorted((x, y) => x.userId.localeCompare(y.userId)),
      );
      await expect(users.findById(lowered.id)).resolves.toMatchObject({
        email: "eve@example.com",
      });
      await expect(users.findById(capitals.id)).resolves.toMatchObject({
        email: "Eve@Example.com",
      });
      await expect(users.findById(shouting.id)).resolves.toMatchObject({
        email: "EVE@example.com",
      });
    });
  });

  describe("when it runs a second time", () => {
    /** @scenario "Running the address step twice changes nothing more" */
    it("finds nothing to do", async () => {
      const users = storedAccounts();
      await users.create({ name: "Ada", email: "Ada@Example.com" });
      await users.create({ name: "Grace", email: "grace@example.com" });
      await runStep({ users });

      await expect(runStep({ users })).resolves.toEqual({
        report: { afterId: null, lowerCased: 0, clashed: 0, clashes: [] },
        saved: [],
      });
    });
  });
});
