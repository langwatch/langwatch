/**
 * Which providers a project can see: every one attached at the project, the
 * team above it, or the organization above that. A read narrowed to the
 * project's own scope would hide the organization-wide credential.
 */

// The database stand-in APPLIES the filter the repository builds rather than
// returning canned rows, so a narrowed query fails here. See
// modules/model-provider/specs/model-provider.feature.
import type { ModelDefaultScope } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";
import { ModelProviderCredentialCodec } from "../../../app/model-provider.members.ts";
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

/** Applies the `scopes.some.OR` filter the repository builds. */
function databaseThatFilters() {
  return {
    modelProvider: {
      findMany: async ({ where }: { where: { scopes: { some: { OR: StoredScope[] } } } }) => {
        const wanted = where.scopes.some.OR;
        return STORED.filter((provider) =>
          provider.scopes.some((scope) =>
            wanted.some(
              (candidate) =>
                candidate.scopeType === scope.scopeType && candidate.scopeId === scope.scopeId,
            ),
          ),
        );
      },
    },
    gatewayChangeEvent: {},
    $transaction: async () => {
      throw new Error("unused capability");
    },
  };
}

class PlainTextCredentials extends ModelProviderCredentialCodec {
  encode(): null {
    return null;
  }

  tryDecode(): null {
    return null;
  }
}

describe("given a project attached to a team and organization", () => {
  describe("when the private repository lists providers for that project", () => {
    /** @scenario "a provider may be visible at project, team, or organization scope" */
    it("returns the providers attached at any of those scopes, and no other project's", async () => {
      const repository = PrismaModelProviderRepository.create(
        databaseThatFilters() as unknown as Parameters<
          typeof PrismaModelProviderRepository.create
        >[0],
        new PlainTextCredentials(),
      );

      const providers = await repository.listForProject(PROJECT_SCOPES);

      expect(providers.map((provider) => provider.id)).toEqual([
        "attached-to-the-project",
        "attached-to-the-team",
        "attached-to-the-organization",
      ]);
    });
  });
});
