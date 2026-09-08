import { describe, expect, it, vi } from "vitest";
import { createApp, defineFeature, featureApi, type FeatureSetup } from "../src/index.ts";
import {
  assertRepositoryOwnership,
  RepositoryOwnershipConflictError,
} from "../src/repository-ownership.ts";

const userTables = { store: "prisma", tables: ["User"] };
const created = vi.fn();

class UserApp {
  static readonly contract = featureApi<UserApp>("user");
  static readonly dependencies = {};
  static readonly repositories = { users: { tables: userTables } };
  private constructor() {}
  static create(_setup: FeatureSetup<typeof UserApp.dependencies, object, undefined>) {
    created();
    return new UserApp();
  }
  ping() {
    return "user";
  }
}

class AnnotationApp {
  static readonly contract = featureApi<AnnotationApp>("annotation");
  static readonly dependencies = {};
  static readonly repositories = { foreign: { tables: userTables } };
  private constructor() {}
  static create(_setup: FeatureSetup<typeof AnnotationApp.dependencies, object, undefined>) {
    created();
    return new AnnotationApp();
  }
  ping() {
    return "annotation";
  }
}

describe("repository ownership", () => {
  it.each(["api", "worker", "task"] as const)(
    "rejects conflicting ownership before any %s factory runs",
    async (role) => {
      created.mockClear();
      const runtime = createApp({ name: "ownership" })
        .withInfrastructure({})
        .withFeature(defineFeature("user").withApp(UserApp).build())
        .withFeature(defineFeature("annotation").withApp(AnnotationApp).build());
      await expect(runtime.boot({ role })).rejects.toThrow(RepositoryOwnershipConflictError);
      expect(created).not.toHaveBeenCalled();
    },
  );

  it("allows two repositories belonging to the same owner", () => {
    expect(() =>
      assertRepositoryOwnership([
        {
          name: "user",
          repositories: {
            profiles: { tables: userTables },
            preferences: { tables: userTables },
          },
        },
      ]),
    ).not.toThrow();
  });

  it("keeps independent storage namespaces separate", () => {
    expect(() =>
      assertRepositoryOwnership([
        { name: "user", repositories: { rows: { tables: userTables } } },
        {
          name: "annotation",
          repositories: { rows: { tables: { store: "clickhouse", tables: ["User"] } } },
        },
      ]),
    ).not.toThrow();
  });

  it("freezes a declaration independently of later metadata mutation", () => {
    const tables = ["AuditLog"];
    const app = {
      contract: UserApp.contract,
      dependencies: {},
      repositories: { rows: { tables: { store: "prisma", tables } } },
      create: UserApp.create,
    };
    const declaration = defineFeature("user").withApp(app).build();
    tables.push("User");
    expect(declaration.repositories?.rows?.tables.tables).toEqual(["AuditLog"]);
    expect(Object.isFrozen(declaration.repositories?.rows?.tables.tables)).toBe(true);
  });

  it("reports the physical table and both owners", () => {
    expect(() =>
      assertRepositoryOwnership([
        { name: "user", repositories: { rows: { tables: userTables } } },
        { name: "annotation", repositories: { rows: { tables: userTables } } },
      ]),
    ).toThrow("Table postgres/User is claimed by both user and annotation");
  });

  it.each([
    { store: "", tables: ["User"] },
    { store: "prisma", tables: [] },
    { store: "prisma", tables: [""] },
  ])("rejects an empty claim %j", (tables) => {
    expect(() =>
      assertRepositoryOwnership([{ name: "user", repositories: { rows: { tables } } }]),
    ).toThrow();
  });
});
