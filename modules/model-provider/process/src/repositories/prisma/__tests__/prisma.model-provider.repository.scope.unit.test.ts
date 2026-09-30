/**
 * Which providers a project can see: every one attached at the project, the
 * team above it, or the organization above that. A read narrowed to the
 * project's own scope would hide the organization-wide credential.
 */

// The database stand-in APPLIES the filter the repository builds rather than
// returning canned rows, so a narrowed query fails here. See
// modules/model-provider/specs/model-provider.feature.
import type { ModelDefaultScope } from "@langwatch/model-provider-contract";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ModelProviderCredentialCodec,
  type CustomKeysRead,
} from "../../../app/model-provider.members.ts";
import { PrismaModelProviderRepository } from "../prisma.model-provider.repository.ts";

const ORGANIZATION_ID = "organization-1";
const TEAM_ID = "team-1";
const PROJECT_ID = "project-1";

/** The three scopes a project stands in, innermost first. */
const PROJECT_SCOPES: ModelDefaultScope[] = [
  { scopeType: "PROJECT", scopeId: PROJECT_ID },
  { scopeType: "TEAM", scopeId: TEAM_ID },
  { scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID },
];

type StoredScope = { scopeType: string; scopeId: string };

function storedProvider(id: string, scope: StoredScope) {
  return {
    id,
    organizationId: ORGANIZATION_ID,
    provider: "openai",
    name: id,
    enabled: true,
    routingHandle: null,
    customKeys: null,
    customModels: null,
    customEmbeddingsModels: null,
    extraHeaders: null,
    rateLimitRpm: null,
    rateLimitTpm: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    scopes: [{ ...scope, id: `${id}-scope`, modelProviderId: id }],
  };
}

const STORED = [
  storedProvider("attached-to-the-project", { scopeType: "PROJECT", scopeId: PROJECT_ID }),
  storedProvider("attached-to-the-team", { scopeType: "TEAM", scopeId: TEAM_ID }),
  storedProvider("attached-to-the-organization", {
    scopeType: "ORGANIZATION",
    scopeId: ORGANIZATION_ID,
  }),
  storedProvider("attached-to-another-project", {
    scopeType: "PROJECT",
    scopeId: "project-elsewhere",
  }),
];

const findManyArgsSchema = z.object({
  where: z.object({
    scopes: z.object({
      some: z.object({ OR: z.array(z.object({ scopeType: z.string(), scopeId: z.string() })) }),
    }),
  }),
});

/** Applies the `scopes.some.OR` filter the repository builds. */
function databaseThatFilters() {
  return prismaDouble({
    modelProvider: {
      findMany: (args) => {
        const wanted = findManyArgsSchema.parse(args).where.scopes.some.OR;
        return Promise.resolve(
          STORED.filter((provider) =>
            provider.scopes.some((scope) =>
              wanted.some(
                (candidate) =>
                  candidate.scopeType === scope.scopeType && candidate.scopeId === scope.scopeId,
              ),
            ),
          ),
        );
      },
    },
  });
}

class PlainTextCredentials extends ModelProviderCredentialCodec {
  encode(): null {
    return null;
  }

  decode(): CustomKeysRead {
    return { state: "absent", keys: {} };
  }
}

describe("given a project attached to a team and organization", () => {
  describe("when the private repository lists providers for that project", () => {
    /** @scenario "a provider may be visible at project, team, or organization scope" */
    it("returns the providers attached at any of those scopes, and no other project's", async () => {
      const repository = PrismaModelProviderRepository.create(
        databaseThatFilters(),
        new PlainTextCredentials(),
      );

      const providers = await repository.findForProject(PROJECT_SCOPES);

      expect(providers.map((provider) => provider.id)).toEqual([
        "attached-to-the-project",
        "attached-to-the-team",
        "attached-to-the-organization",
      ]);
    });
  });
});

describe("given the setup checklist asks whether a provider is configured", () => {
  describe("when the repository counts the enabled providers in the project's scopes", () => {
    /** @scenario All database access goes through the repository */
    it("counts one issued by the repository, an organization one included, and reads no credential", async () => {
      const issued: unknown[] = [];
      const database = prismaDouble({
        modelProvider: {
          count: (args) => {
            issued.push(args);
            const wanted = findManyArgsSchema.parse(args).where.scopes.some.OR;
            return Promise.resolve(
              STORED.filter((provider) =>
                provider.scopes.some((scope) =>
                  wanted.some(
                    (candidate) =>
                      candidate.scopeType === scope.scopeType &&
                      candidate.scopeId === scope.scopeId,
                  ),
                ),
              ).length,
            );
          },
        },
      });
      const repository = PrismaModelProviderRepository.create(database, new PlainTextCredentials());

      const count = await repository.countEnabledInScopes({ scopes: PROJECT_SCOPES });

      expect(count).toBe(3);
      expect(issued).toHaveLength(1);
      expect(issued[0]).not.toHaveProperty("select");
      expect(issued[0]).toMatchObject({ where: { enabled: true, disabledAt: null } });
    });
  });
});
