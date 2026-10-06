/**
 * Sealed ADR-166 proofs for tests that read ClickHouse through the
 * authorized client (ADR-144 block C), and the fence expansion a test needs
 * when it runs a compiled fragment through a raw client of its own.
 */
import { type Authorization, sealAuthorization } from "@langwatch/actor";
import { AUTHORIZATION_MAX_AGE_MS } from "~/server/app-layer/authz/authorization.service";
import {
  expandFragment,
  expandStatement,
  fenceFor,
  type ReadResource,
} from "~/server/app-layer/clients/clickhouse/authorized-reads";

const TEST_ACTOR = { type: "user", id: "test-user" } as const;
const TEST_ORGANIZATION_ID = "test-organization";
const TEST_PERMISSIONS = ["traces:view", "analytics:view"] as const;

/** The proof a plain project's route mints: one own grant, nothing shared. */
export function ownProof({
  projectId,
  now = Date.now(),
}: {
  projectId: string;
  now?: number;
}): Authorization {
  return sealAuthorization({
    actor: TEST_ACTOR,
    principal: TEST_ACTOR,
    scope: { organizationId: TEST_ORGANIZATION_ID },
    grants: [
      {
        projectId,
        permissions: [...TEST_PERMISSIONS],
        via: [],
        kind: "own",
      },
    ],
    expiresAt: now + AUTHORIZATION_MAX_AGE_MS,
    purpose: { kind: "route", route: "test" },
  });
}

/**
 * An aggregate's proof: own on the aggregate, one shared grant per member
 * with the window its grant opens (`until` open-ended unless given).
 */
export function aggregateProof({
  projectId,
  members,
  now = Date.now(),
}: {
  projectId: string;
  members: { projectId: string; from: number; until?: number | null }[];
  now?: number;
}): Authorization {
  return sealAuthorization({
    actor: TEST_ACTOR,
    principal: TEST_ACTOR,
    scope: { organizationId: TEST_ORGANIZATION_ID },
    grants: [
      {
        projectId,
        permissions: [...TEST_PERMISSIONS],
        via: [],
        kind: "own",
      },
      ...members.map((member, index) => ({
        projectId: member.projectId,
        permissions: ["traces:view"],
        via: [`grant_${index}`],
        kind: "shared" as const,
        condition: {
          type: "trace" as const,
          from: member.from,
          until: member.until ?? null,
        },
      })),
    ],
    expiresAt: now + AUTHORIZATION_MAX_AGE_MS,
    purpose: { kind: "route", route: "test" },
  });
}

/**
 * A statement with markers, expanded for one own project the way the reader
 * would, for a test that sends it through a raw client.
 */
export function expandStatementForProject({
  query,
  queryParams,
  projectId,
  reads = "traces",
}: {
  query: string;
  queryParams: Record<string, unknown>;
  projectId: string;
  reads?: ReadResource;
}): { query: string; queryParams: Record<string, unknown> } {
  return expandStatement({
    query,
    queryParams,
    fence: fenceFor({ authorization: ownProof({ projectId }), reads }),
  });
}

/** A compiled filter fragment, expanded for one own project. */
export function expandFragmentForProject({
  fragment,
  params,
  projectId,
}: {
  fragment: string;
  params: Record<string, unknown>;
  projectId: string;
}): { sql: string; params: Record<string, unknown> } {
  return expandFragment({
    fragment,
    queryParams: params,
    fence: fenceFor({
      authorization: ownProof({ projectId }),
      reads: "traces",
    }),
  });
}
