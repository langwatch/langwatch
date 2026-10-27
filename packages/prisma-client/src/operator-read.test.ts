import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "./generated/client.ts";
import {
  OperatorRead,
  OperatorReadGuard,
  type OperatorReadLog,
  OperatorReadsResolver,
} from "./operator-read.ts";
import { guardOrganizationId } from "./organization-guard.ts";

const syncs = OperatorRead.of("ScimSyncState", { actions: ["findMany", "count"] });

function guardFor() {
  const lines: { fields: object; message: string }[] = [];
  const logger: OperatorReadLog = { info: (fields, message) => lines.push({ fields, message }) };
  const guard = OperatorReadGuard.create({ owner: "scim", handle: syncs, logger });
  return { guard, lines };
}

function refusal(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

const reached = () => vi.fn(async () => "rows");

describe("declared operator reads", () => {
  describe("when the default guarded client reads without an organization", () => {
    /** @scenario "An unscoped read without a declaration is refused" */
    it("refuses the read", async () => {
      const next = reached();
      await expect(
        guardOrganizationId({ model: "ScimSyncState", action: "findMany", args: {} }, next),
      ).rejects.toThrow(/organizationId/);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("when a declared client reads a model it did not declare", () => {
    /** @scenario "A declared operator read refuses a model it did not declare" */
    it("refuses naming the declaring module", () => {
      const { guard } = guardFor();
      const next = reached();
      expect(
        refusal(() =>
          guard.execute({ model: "Team", action: "findMany", args: { where: {} } }, next),
        ),
      ).toMatchObject({ code: "operator_read_refused" });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("when a declared client writes", () => {
    /** @scenario "A declared operator read refuses writes" */
    it("refuses the write and any undeclared read action", () => {
      const { guard } = guardFor();
      const next = reached();
      for (const action of ["updateMany", "deleteMany", "create", "findFirst"]) {
        expect(
          refusal(() =>
            guard.execute({ model: "ScimSyncState", action, args: { where: {} } }, next),
          ),
        ).toMatchObject({ code: "operator_read_refused" });
      }
      expect(refusal(() => guard.execute({ action: "queryRaw", args: [] }, next))).toMatchObject({
        code: "operator_read_refused",
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("when a declared client reads its model with a declared action", () => {
    /** @scenario "A declared operator read is admitted and logged" */
    it("reaches the database and logs module, model and action only", async () => {
      const { guard, lines } = guardFor();
      const next = reached();
      const args = { where: {}, take: 10 };
      await expect(
        guard.execute({ model: "ScimSyncState", action: "findMany", args }, next),
      ).resolves.toBe("rows");
      expect(next).toHaveBeenCalledWith(args);
      expect(lines).toEqual([
        {
          fields: { module: "scim", model: "ScimSyncState", action: "findMany" },
          message: "operator read",
        },
      ]);
    });
  });

  describe("when a module resolves a handle it did not declare", () => {
    /** @scenario "A module cannot resolve an operator read it did not declare" */
    it("refuses naming the module", () => {
      const mint = vi.fn((): PrismaClient => Object.create(null));
      const resolver = OperatorReadsResolver.over({ mint });
      const scoped = resolver.scopeTo({ owner: "governance", declared: [] });
      expect(refusal(() => scoped.into(syncs, (client) => client))).toMatchObject({
        code: "operator_read_undeclared",
      });
      expect(mint).not.toHaveBeenCalled();
    });
  });

  describe("when a module declares a hand-built lookalike handle", () => {
    it("refuses to scope it", () => {
      const resolver = OperatorReadsResolver.over({ mint: () => Object.create(null) });
      const forged = { model: "ScimSyncState", actions: ["findMany"] };
      expect(refusal(() => resolver.scopeTo({ owner: "scim", declared: [forged] }))).toMatchObject({
        code: "operator_read_forged",
      });
    });
  });

  describe("when the resolver has sealed", () => {
    /** @scenario "Operator reads cannot be resolved after boot" */
    it("refuses a declared handle", () => {
      const resolver = OperatorReadsResolver.over({ mint: () => Object.create(null) });
      const scoped = resolver.scopeTo({ owner: "scim", declared: [syncs] });
      resolver.seal();
      expect(refusal(() => scoped.into(syncs, (client) => client))).toMatchObject({
        code: "operator_reads_sealed",
      });
    });
  });

  it("refuses declaring a model the organization guard does not guard", () => {
    expect(refusal(() => OperatorRead.of("Project", { actions: ["findMany"] }))).toMatchObject({
      code: "operator_read_unguarded_model",
    });
  });
});
