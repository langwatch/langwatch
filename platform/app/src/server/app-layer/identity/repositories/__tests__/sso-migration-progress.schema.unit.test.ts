/**
 * @vitest-environment node
 *
 * Every field the migration-progress read asks Prisma for, checked against the
 * schema Prisma actually has.
 *
 * WHY THIS EXISTS. The linked/straggler clauses were
 * `user: { identifiers: { some: … } }`, and there is no `identifiers`
 * relation on `User` — `Identifier` carries a bare `userId` with an index and
 * no back-reference. Prisma rejects an unknown argument at RUNTIME, so this
 * threw on every call, for every organization, unconditionally — and because
 * `getSetup` embeds the migration view, any organization that had registered
 * a replacement lost its whole Identity provider page to a 500. The
 * Authentication overview then read "Single sign-on — Not set up" for an
 * organization with live single sign-on and a migration under way.
 *
 * A mocked Prisma accepts any object, so a double alone would have happily
 * passed the invented relation through — which is exactly how this reached a
 * customer-facing page with the repository otherwise untested. So the double
 * RECORDS what it was asked, and the assertion is made against
 * `prisma/schema.prisma` itself: every field named in a where clause has to
 * be a field the model really has. That is the part a database would have
 * told us, without needing one.
 *
 * Spec: specs/identity/sso-idp-termination.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { parsePrismaDatamodel } from "~/test-utils/prismaDatamodel";
import { PrismaSsoMigrationProgressRepository } from "../sso-migration-progress.prisma.repository";

const datamodel = parsePrismaDatamodel();
const fieldsOf = (model: string): string[] =>
  datamodel.find((entry) => entry.name === model)?.fields ?? [];

/** Prisma's own filter vocabulary, which is never a model field. */
const OPERATORS = new Set([
  "in", "notIn", "not", "gt", "gte", "lt", "lte", "equals", "contains",
  "startsWith", "endsWith", "some", "none", "every", "is", "isNot",
  "AND", "OR", "NOT", "mode", "search",
]);

/**
 * Walks a where clause and reports every `model.field` it names that the
 * schema does not have.
 */
function unknownFieldsIn({
  model,
  clause,
}: {
  model: string;
  clause: unknown;
}): string[] {
  if (!clause || typeof clause !== "object") return [];
  const known = fieldsOf(model);
  const missing: string[] = [];
  for (const [key, value] of Object.entries(clause as Record<string, unknown>)) {
    if (OPERATORS.has(key)) {
      // An operator's payload is still filtered against the SAME model.
      missing.push(...unknownFieldsIn({ model, clause: value }));
      continue;
    }
    if (!known.includes(key)) {
      missing.push(`${model}.${key}`);
      continue;
    }
    // A known key whose value is an object is a relation traversal. The
    // related model is not derivable from this parse, so the nested names are
    // checked against every model — only a name no model anywhere has is
    // reported, which is still enough to have caught `identifiers`.
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const nested of Object.keys(value as Record<string, unknown>)) {
        if (OPERATORS.has(nested)) continue;
        const existsSomewhere = datamodel.some((entry) =>
          entry.fields.includes(nested),
        );
        if (!existsSomewhere) missing.push(`${model}.${key}.${nested}`);
      }
    }
  }
  return missing;
}

function recordingPrisma() {
  const asked: { model: string; where: unknown }[] = [];
  const record = (model: string) => ({
    findMany: vi.fn(async (args: { where?: unknown }) => {
      asked.push({ model, where: args?.where });
      return [];
    }),
    count: vi.fn(async (args: { where?: unknown }) => {
      asked.push({ model, where: args?.where });
      return 0;
    }),
    findFirst: vi.fn(async (args: { where?: unknown }) => {
      asked.push({ model, where: args?.where });
      return model === "SsoConnection"
        ? {
            id: "ssoc_replacement",
            organizationId: "org_acme",
            state: "VERIFIED",
            migrationPhase: "SETUP",
            migrationRoute: "legacy",
            replacesConnectionId: "ssoc_legacy",
            idpMetadata: { providerId: "acme" },
            type: "OIDC",
            createdAt: new Date(0),
            updatedAt: new Date(0),
          }
        : null;
    }),
  });
  const prisma = {
    ssoConnection: record("SsoConnection"),
    organizationUser: record("OrganizationUser"),
    identifier: record("Identifier"),
    ssoBreakGlassBinding: record("SsoBreakGlassBinding"),
    ssoAuthenticationActivity: record("SsoAuthenticationActivity"),
    scimSyncState: record("ScimSyncState"),
  } as unknown as PrismaClient;
  return { prisma, asked };
}

describe("given the migration progress read", () => {
  describe("when it asks the database for a member evidence page", () => {
    it("names only fields the schema actually has", async () => {
      const { prisma, asked } = recordingPrisma();

      // Drives the real code path. A throw here is itself the regression —
      // the repository is allowed to find nothing, not to build a bad query.
      await new PrismaSsoMigrationProgressRepository(prisma).getProgress({
        organizationId: "org_acme",
        cursor: null,
        limit: 25,
      });

      const unknown = asked.flatMap(({ model, where }) =>
        unknownFieldsIn({ model, clause: where }),
      );
      expect(unknown).toEqual([]);
    });

    it("has no `identifiers` relation on User to traverse, which is the whole point", () => {
      // If this ever becomes false the clause above may legitimately go back
      // to a relation traversal — and this test should be revisited rather
      // than worked around.
      expect(fieldsOf("User")).not.toContain("identifiers");
      expect(fieldsOf("Identifier")).toContain("userId");
    });
  });
});
