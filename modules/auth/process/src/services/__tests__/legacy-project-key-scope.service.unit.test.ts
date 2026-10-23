/**
 * What a legacy project key holds: the ingestion permission by its class, anything else on a
 * scope flag the route names or `legacy_project_key_full_access`, and outside them everything
 * unless `legacy_project_key_scope_enforced` lists its project; and the lines each decision logs.
 * @see modules/auth/specs/legacy-project-key-scope.feature
 */
import { LEGACY_PROJECT_KEY_SCOPE_FLAGS } from "@langwatch/api-key-contract";
import type { AuthzPermission } from "@langwatch/authorization";
import {
  LEGACY_PROJECT_KEY_SCOPE_ENFORCED_FLAG_KEY,
  pickFlagDefinition,
  type FeatureFlagApi,
} from "@langwatch/feature-flag-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { LegacyProjectKeyScopeService } from "../legacy-project-key-scope.service.ts";

const PROJECT = { id: "project-1", organizationId: "org-1" };
const TARGET = { kind: "project", projectId: "project-1", organizationId: "org-1" };
const FULL_ACCESS = "legacy_project_key_full_access";
const PROMPTS_READ = "legacy_project_key_prompts_read";
const ENFORCED = LEGACY_PROJECT_KEY_SCOPE_ENFORCED_FLAG_KEY;
const ROUTE = "POST /api/prompts/:id";

type Line = { level: "info" | "warn"; fields: Record<string, unknown>; message: string };

/** `enabled` names the flags whose rule lists the project; `clock` is epoch milliseconds. */
function scope({
  enabled,
  clock = { now: 0 },
}: {
  enabled: readonly string[];
  clock?: { now: number };
}) {
  const reads: Parameters<FeatureFlagApi["isEnabled"]>[] = [];
  const lines: Line[] = [];
  const service = LegacyProjectKeyScopeService.create({
    featureFlags: createApiFixture<FeatureFlagApi>({
      isEnabled: async (...read) => {
        reads.push(read);
        return enabled.includes(read[0]);
      },
    }),
    logger: {
      info: (fields: Record<string, unknown>, message: string) =>
        void lines.push({ level: "info", fields, message }),
      warn: (fields: Record<string, unknown>, message: string) =>
        void lines.push({ level: "warn", fields, message }),
    } as never,
    now: () => clock.now,
  });

  return { service, reads, lines };
}

const BEYOND_INGESTION: readonly AuthzPermission[] = [
  "prompts:view",
  "traces:view",
  "scenarios:manage",
  "project:view",
  "organization:manage",
];

describe("given a legacy project key", () => {
  describe("when it is asked traces:create", () => {
    /** @scenario "The ingestion permission never reads the full-access flag" */
    it("holds it without reading any flag", async () => {
      const { service, reads } = scope({ enabled: [] });

      await expect(
        service.holds({ project: PROJECT, permission: "traces:create", route: ROUTE }),
      ).resolves.toBe(true);
      expect(reads).toEqual([]);
    });
  });

  describe("when the route names no scope flag", () => {
    /** @scenario "The full-access flag is read for the key's own project" */
    it("reads the full-access flag for its project and organization", async () => {
      const off = scope({ enabled: [ENFORCED] });
      const on = scope({ enabled: [FULL_ACCESS] });

      await expect(
        off.service.holds({ project: PROJECT, permission: "prompts:view", route: ROUTE }),
      ).resolves.toBe(false);
      await expect(
        on.service.holds({ project: PROJECT, permission: "prompts:view", route: ROUTE }),
      ).resolves.toBe(true);
      expect(off.reads).toEqual([
        [FULL_ACCESS, TARGET],
        [ENFORCED, TARGET],
      ]);
    });

    /** @scenario "A route that names no scope flag reads only the full-access and enforced flags" */
    it.each(BEYOND_INGESTION)(
      "does not hold %s on an enforced project even when every scope flag lists it",
      async (permission) => {
        const { service, reads } = scope({
          enabled: [...LEGACY_PROJECT_KEY_SCOPE_FLAGS, ENFORCED],
        });

        await expect(service.holds({ project: PROJECT, permission, route: ROUTE })).resolves.toBe(
          false,
        );
        expect(reads).toEqual([
          [FULL_ACCESS, TARGET],
          [ENFORCED, TARGET],
        ]);
      },
    );
  });

  describe("when the route names the prompts-read flag", () => {
    /** @scenario "Only the scope flags the route names are read" */
    it("reads that flag, then full access, and no other scope flag", async () => {
      const off = scope({ enabled: [ENFORCED] });
      const on = scope({ enabled: [PROMPTS_READ] });
      const asked = {
        project: PROJECT,
        permission: "prompts:view" as const,
        route: ROUTE,
        routeScopes: [PROMPTS_READ],
      };

      await expect(off.service.holds(asked)).resolves.toBe(false);
      await expect(on.service.holds(asked)).resolves.toBe(true);
      expect(off.reads).toEqual([
        [PROMPTS_READ, TARGET],
        [FULL_ACCESS, TARGET],
        [ENFORCED, TARGET],
      ]);
      expect(on.reads).toEqual([[PROMPTS_READ, TARGET]]);
    });

    it("refuses a scope name that is not a scope flag", async () => {
      await expect(
        scope({ enabled: [] }).service.holds({
          project: PROJECT,
          permission: "prompts:view",
          route: ROUTE,
          routeScopes: ["legacy_project_key_everything"],
        }),
      ).rejects.toMatchObject({ issues: [{ code: "invalid_value" }] });
    });
  });

  describe("when its project is on the full-access flag only", () => {
    /** @scenario "Full access holds every permission" */
    it.each(BEYOND_INGESTION)("holds %s on any route", async (permission) => {
      const { service } = scope({ enabled: [FULL_ACCESS] });

      await expect(service.holds({ project: PROJECT, permission, route: ROUTE })).resolves.toBe(
        true,
      );
      await expect(
        service.holds({ project: PROJECT, permission, route: ROUTE, routeScopes: [PROMPTS_READ] }),
      ).resolves.toBe(true);
    });
  });

  describe("when a route asks it nothing", () => {
    const asked = { project: PROJECT, route: "GET /api/whoami" };

    /** @scenario "A legacy project key on an enforced project is refused a route that asks no permission" */
    it("is refused on an enforced project unless it has full access", async () => {
      await expect(
        scope({ enabled: [...LEGACY_PROJECT_KEY_SCOPE_FLAGS, ENFORCED] }).service.assertMayIdentify(
          asked,
        ),
      ).rejects.toMatchObject({ code: "legacy_project_key_ingestion_only", httpStatus: 403 });
      await expect(
        scope({ enabled: [FULL_ACCESS, ENFORCED] }).service.assertMayIdentify(asked),
      ).resolves.toBe(undefined);
    });

    /** @scenario "An unenforced project's legacy key passes identify-only routes and the key door" */
    it("passes on an unenforced project, logged outside its scopes", async () => {
      const { service, lines } = scope({ enabled: [] });

      await expect(service.assertMayIdentify(asked)).resolves.toBe(undefined);
      expect(lines[0]).toMatchObject({
        level: "warn",
        message: "legacy project key outside its scopes",
        fields: { route: "GET /api/whoami", permission: null, enforced: false },
      });
    });
  });
});

describe("the lines a legacy key decision logs", () => {
  const asked = { project: PROJECT, permission: "prompts:view" as const, route: ROUTE };

  /** @scenario "A legacy key on an unenforced project reaches a prompts route" */
  it("holds a permission outside its scopes on an unenforced project, logging both lines", async () => {
    const { service, lines } = scope({ enabled: [] });

    await expect(service.holds(asked)).resolves.toBe(true);
    const common = {
      projectId: "project-1",
      organizationId: "org-1",
      route: ROUTE,
      permission: "prompts:view",
      routeScopes: [],
      suppressed: 0,
    };
    expect(lines).toEqual([
      {
        level: "warn",
        message: "legacy project key outside its scopes",
        fields: { ...common, enforced: false },
      },
      {
        level: "info",
        message: "legacy project key request",
        fields: { ...common, grantedBy: "report_only", scopeFlagGranted: false },
      },
    ]);
  });

  /** @scenario "A legacy project key on an enforced project is refused prompts, traces, evaluations and datasets" */
  it("logs only the outside-scope line, enforced, when it refuses", async () => {
    const { service, lines } = scope({ enabled: [ENFORCED] });

    await expect(service.holds(asked)).resolves.toBe(false);
    expect(lines).toEqual([
      expect.objectContaining({
        level: "warn",
        message: "legacy project key outside its scopes",
        fields: expect.objectContaining({ enforced: true }),
      }),
    ]);
  });

  /** @scenario "A scope grant writes a census line naming its flag" */
  it("writes one census line naming the flag that granted it", async () => {
    const { service, lines } = scope({ enabled: [PROMPTS_READ] });

    await service.holds({ ...asked, routeScopes: [PROMPTS_READ] });
    expect(lines).toEqual([
      expect.objectContaining({
        level: "info",
        message: "legacy project key request",
        fields: expect.objectContaining({ grantedBy: PROMPTS_READ, scopeFlagGranted: true }),
      }),
    ]);
  });

  /** @scenario "A census line is written once a minute per project, route and permission" */
  it("holds the same use back for a minute and counts it on the next line", async () => {
    const clock = { now: 0 };
    const { service, lines } = scope({ enabled: [PROMPTS_READ], clock });
    const granted = { ...asked, routeScopes: [PROMPTS_READ] };

    await service.holds(granted);
    clock.now = 30_000;
    await service.holds(granted);
    await service.holds({ ...granted, route: "GET /api/prompts" });
    clock.now = 61_000;
    await service.holds(granted);

    expect(lines.map((line) => [line.fields.route, line.fields.suppressed])).toEqual([
      [ROUTE, 0],
      ["GET /api/prompts", 0],
      [ROUTE, 1],
    ]);
  });

  /** @scenario "Ingestion and full access write no line" */
  it("writes nothing for ingestion or full access, and never reads the enforced flag", async () => {
    const ingest = scope({ enabled: [] });
    const full = scope({ enabled: [FULL_ACCESS] });

    await ingest.service.holds({ ...asked, permission: "traces:create" });
    await full.service.holds(asked);
    expect([...ingest.lines, ...full.lines]).toEqual([]);
    expect([...ingest.reads, ...full.reads].map(([flag]) => flag)).not.toContain(ENFORCED);
  });
});

describe("the scope flag list", () => {
  /** @scenario "Every scope flag is a registered feature flag" */
  it("names only registered product flags that are off by default", () => {
    for (const flag of LEGACY_PROJECT_KEY_SCOPE_FLAGS) {
      expect(pickFlagDefinition(flag)).toMatchObject({
        key: flag,
        scope: "PRODUCT",
        defaultValue: false,
      });
    }
    expect(pickFlagDefinition(ENFORCED)).toMatchObject({ scope: "PRODUCT", defaultValue: false });
  });
});
