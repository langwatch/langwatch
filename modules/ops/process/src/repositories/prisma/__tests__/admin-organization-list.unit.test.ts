/**
 * @vitest-environment node
 * What the instance admin organization list hands the operator's browser.
 * @see specs/self-hosting/connected-services/license-registry.feature
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaAdminBackofficeRepository as InstanceAdminRepository } from "../prisma.admin-backoffice.repository.ts";

const LICENSE_KEY = "signed-license-key-material";

/** A stored organization, license key included, as the table holds it. */
const STORED_ORGANIZATIONS = [
  {
    id: "org_1",
    name: "Acme",
    slug: "acme",
    license: LICENSE_KEY,
    licenseExpiresAt: new Date("2027-01-01T00:00:00.000Z"),
    licenseLastValidatedAt: new Date("2026-10-01T00:00:00.000Z"),
  },
  {
    id: "org_2",
    name: "Globex",
    slug: "globex",
    license: LICENSE_KEY,
    licenseExpiresAt: null,
    licenseLastValidatedAt: null,
  },
];

type Row = (typeof STORED_ORGANIZATIONS)[number];

/** A row the way the database returns it: only the columns `select` names. */
function selected(row: Row, select: object | null | undefined): Partial<Row> {
  if (!select) return row;
  const wanted = select as Record<string, boolean>;
  return Object.fromEntries(Object.entries(row).filter(([column]) => wanted[column]));
}

function organizationDelegate() {
  const findMany = vi.fn(async (args?: { select?: object | null }) =>
    STORED_ORGANIZATIONS.map((row) => selected(row, args?.select)),
  );
  const count = vi.fn(async () => STORED_ORGANIZATIONS.length);
  return prismaDouble({ organization: { findMany, count } });
}

/** The operator's request, as the route hands it to the repository. */
const LIST_ORGANIZATIONS = {
  method: "getList",
  resource: "organization",
  params: {},
  actorId: "operator_1",
  req: { headers: {} },
} as const;

describe("the instance admin organization read", () => {
  describe("when an operator lists organizations in the instance admin", () => {
    /** @scenario "The instance admin organizations list does not carry license keys" */
    it("answers every organization without its license key", async () => {
      const repository = InstanceAdminRepository.create(organizationDelegate());

      const result = await repository.execute(LIST_ORGANIZATIONS);

      if (!("total" in result)) throw new Error("a list answers rows and a total");
      expect(result.data).toHaveLength(2);
      for (const organization of result.data as Record<string, unknown>[]) {
        expect(organization).not.toHaveProperty("license");
      }
      expect(JSON.stringify(result)).not.toContain(LICENSE_KEY);
    });

    it("still carries the term the license runs to", async () => {
      const repository = InstanceAdminRepository.create(organizationDelegate());

      const result = await repository.execute(LIST_ORGANIZATIONS);

      expect(result.data).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "org_1" })]),
      );
      expect((result.data as Record<string, unknown>[])[0]).toHaveProperty("licenseExpiresAt");
    });
  });
});
