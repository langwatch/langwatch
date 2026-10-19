// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The routing-policy repository answers alike over its memory twin and over Postgres (the
 * Postgres half runs when LANGWATCH_TEST_DATABASE_URL names a database).
 * Spec: enterprise/modules/enterprise-gateway/specs/enterprise-gateway.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { MemoryRoutingPolicyRepository } from "../memory/memory.routing-policy.repository.ts";
import { PrismaRoutingPolicyRepository } from "../prisma/prisma.routing-policy.repository.ts";
import type { RoutingPolicyRepository } from "../routing-policy.repository.ts";

type Backend = Readonly<{
  repository: () => RoutingPolicyRepository;
  namespace: () => string;
}>;

function contractCases(backend: Backend): void {
  const organizationId = () => `org_${backend.namespace()}`;
  const actorUserId = () => `user_${backend.namespace()}`;
  const make = (name: string, isDefault = false) =>
    backend.repository().create({
      organizationId: organizationId(),
      name,
      modelProviderIds: [],
      scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId() }],
      isDefault,
      actorUserId: actorUserId(),
    });

  it("reads back the policy it created", async () => {
    const created = await make("first");

    await expect(backend.repository().findById(created.id)).resolves.toMatchObject({
      id: created.id,
      name: "first",
      organizationId: organizationId(),
      isDefault: false,
    });
  });

  it("finds nothing for an id it never held", async () => {
    await expect(
      backend.repository().findById(`missing_${backend.namespace()}`),
    ).resolves.toBeNull();
  });

  it("counts and lists only the organization's policies", async () => {
    await make("first");
    await make("second");

    await expect(backend.repository().count({ organizationId: organizationId() })).resolves.toBe(2);
    const listed = await backend.repository().findAll({ organizationId: organizationId() });
    expect(listed.map((policy) => policy.name).toSorted()).toEqual(["first", "second"]);
  });

  it("leaves exactly one default when another policy is made the default", async () => {
    const first = await make("first", true);
    const second = await make("second");

    await backend.repository().setDefault({
      id: second.id,
      organizationId: organizationId(),
      actorUserId: actorUserId(),
    });

    await expect(
      backend.repository().findDefaultForUser({ organizationId: organizationId() }),
    ).resolves.toMatchObject({ id: second.id });
    await expect(backend.repository().findById(first.id)).resolves.toMatchObject({
      isDefault: false,
    });
  });

  it("forgets a deleted policy", async () => {
    const created = await make("first");

    await backend.repository().delete({ id: created.id, organizationId: organizationId() });

    await expect(backend.repository().findById(created.id)).resolves.toBeNull();
  });
}

describe("given the routing-policy memory repository", () => {
  let repository: RoutingPolicyRepository;
  beforeEach(() => {
    repository = MemoryRoutingPolicyRepository.create();
  });

  contractCases({ repository: () => repository, namespace: () => "memory" });
});

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("routing-policy-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
  return connection.client;
}

describe.skipIf(!databaseUrl)("given the routing-policy Postgres repository", () => {
  const namespace = randomUUID();
  const clean = () =>
    cleanupTestRows(database(), [
      ["organization", { id: `org_${namespace}` }],
      ["user", { id: `user_${namespace}` }],
    ]);

  beforeEach(async () => {
    await clean();
    await database().organization.create({
      data: { id: `org_${namespace}`, name: "Routing policy test", slug: `org-${namespace}` },
    });
    await database().user.create({ data: { id: `user_${namespace}` } });
  });
  afterAll(clean);

  contractCases({
    repository: () => PrismaRoutingPolicyRepository.create(database()),
    namespace: () => namespace,
  });
});
