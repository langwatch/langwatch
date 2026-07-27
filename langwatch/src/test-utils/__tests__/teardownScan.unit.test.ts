/**
 * Pins the teardown-safety rule itself, so the CI gate in
 * scripts/check-test-teardown.ts cannot quietly stop checking: if the
 * scanner regresses to finding nothing, these fail. That is the #6169
 * lesson, gates that report success while verifying nothing.
 *
 * Spec: specs/setup/test-teardown-safety.feature
 */
import { describe, expect, it } from "vitest";
import { scanTestSourceForUnsafeDeleteMany } from "../teardownScan";

function scan(sourceText: string) {
  return scanTestSourceForUnsafeDeleteMany("virtual.test.ts", sourceText);
}

describe("scanTestSourceForUnsafeDeleteMany", () => {
  describe("given a delete filtered by a let-declared id", () => {
    /** @scenario "A reassignable id in a raw delete fails the check" */
    it("flags it, naming the variable and the line", () => {
      const violations = scan(
        [
          `let teamId: string;`,
          `beforeAll(async () => { teamId = "team_1"; });`,
          `afterAll(async () => {`,
          `  await prisma.team.deleteMany({ where: { id: teamId } });`,
          `});`,
        ].join("\n"),
      );

      expect(violations).toEqual([
        expect.objectContaining({
          variable: "teamId",
          model: "team",
          line: 4,
        }),
      ]);
    });

    it("flags it inside an in-list, where Prisma collapses the same way", () => {
      const violations = scan(
        [
          `let orgId: string;`,
          `await prisma.team.deleteMany({ where: { organizationId: { in: [orgId] } } });`,
        ].join("\n"),
      );

      expect(violations).toEqual([
        expect.objectContaining({ variable: "orgId", model: "team" }),
      ]);
    });

    it("flags a shorthand property", () => {
      const violations = scan(
        [
          `let organizationId: string;`,
          `await prisma.roleBinding.deleteMany({ where: { organizationId } });`,
        ].join("\n"),
      );

      expect(violations).toEqual([
        expect.objectContaining({
          variable: "organizationId",
          model: "roleBinding",
        }),
      ]);
    });

    it("sees through a non-null assertion, which does nothing at runtime", () => {
      const violations = scan(
        [
          `let teamId: string | undefined;`,
          `await prisma.team.deleteMany({ where: { id: teamId! } });`,
        ].join("\n"),
      );

      expect(violations).toEqual([
        expect.objectContaining({ variable: "teamId" }),
      ]);
    });
  });

  describe("given a delete filtered by a module constant", () => {
    /** @scenario "A module constant in a raw delete passes the check" */
    it("passes: a const initialized at import time cannot be undefined", () => {
      const violations = scan(
        [
          `const ns = "suite-abc123";`,
          `const orgId = generate("organization").toString();`,
          `await prisma.organization.deleteMany({ where: { id: orgId } });`,
          `await prisma.user.deleteMany({ where: { email: \`x-\${ns}@example.com\` } });`,
        ].join("\n"),
      );

      expect(violations).toEqual([]);
    });

    it("passes literals and safe in-lists", () => {
      const violations = scan(
        [
          `const a = "org_a";`,
          `const b = "org_b";`,
          `await prisma.organization.deleteMany({ where: { id: { in: [a, b] } } });`,
        ].join("\n"),
      );

      expect(violations).toEqual([]);
    });
  });

  describe("given an unfiltered delete", () => {
    /** @scenario "An unfiltered delete fails the check" */
    it("flags deleteMany with no arguments", () => {
      const violations = scan(`await prisma.team.deleteMany();`);

      expect(violations).toEqual([
        expect.objectContaining({ variable: "<none>", model: "team" }),
      ]);
    });

    /** @scenario "An unfiltered delete fails the check" */
    it("flags deleteMany without a where clause", () => {
      const violations = scan(`await prisma.team.deleteMany({});`);

      expect(violations).toEqual([
        expect.objectContaining({ variable: "<none>", model: "team" }),
      ]);
    });
  });

  describe("given deleteMany on something other than prisma", () => {
    it("still flags it: any deleteMany in a test file is a database write", () => {
      // ctx.prisma, tx, a repository holding the client: the collapse is
      // identical whatever the client is called.
      const violations = scan(
        [
          `let orgId: string;`,
          `await ctx.prisma.organization.deleteMany({ where: { id: orgId } });`,
        ].join("\n"),
      );

      expect(violations).toEqual([
        expect.objectContaining({ variable: "orgId", model: "organization" }),
      ]);
    });
  });
});
