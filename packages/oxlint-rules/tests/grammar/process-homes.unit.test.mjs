import { describe, expect, it } from "vitest";

import {
  RULES_PATTERN,
  PROCESS_HOMES,
  PROCESS_MANAGER_SERVICE_PATTERN,
  PROCESS_PATTERNS,
  SERVICE_MODULE_PATTERN,
  stripFeaturePrefix,
} from "../../grammar/feature-layout-policy.mjs";

// The message a refused file prints is the allowlist read aloud. If the two
// drift, the linter refuses a file and then names a folder it would refuse
// again, which is how an agent gets coached into the shape being deleted.

const EXAMPLE = [
  "index.ts",
  "annotation.module.ts",
  "app/annotation.app.ts",
  "app/annotation.members.ts",
  "transport/annotation.rest.ts",
  "transport/annotation.trpc.ts",
  "services/annotation.service.ts",
  "repositories/annotation.repository.ts",
  "repositories/annotation-repositories.registry.ts",
  "repositories/prisma/prisma.annotation.repository.ts",
  "channels/annotation.channel.ts",
  "channels/slack/slack.annotation.channel.ts",
  "eventing/annotation.pipeline.ts",
  "eventing/annotation.projection.ts",
  "rules/scoring.rules.ts",
  "tasks/backfill.task.ts",
  "app/annotation-composition.build.ts",
];

const REFUSED = [
  "ports/annotation.port.ts",
  "adapters/postgres.annotation.adapter.ts",
  "stores/annotation.store.ts",
  "fixtures/annotation.fixture.ts",
  "transport/api-rest/annotation.api.ts",
];

const NESTED = [
  "features/billing/services/invoice.service.ts",
  "features/billing/rules/invoice.rules.ts",
  "features/billing/repositories/invoice.repository.ts",
  "features/billing/repositories/invoice-repositories.registry.ts",
  "features/billing/repositories/prisma/prisma.invoice.repository.ts",
  "features/billing/eventing/invoice.pipeline.ts",
  "features/billing/eventing/invoice.projection.ts",
  "features/billing/eventing/invoice/invoice.events.ts",
];

const NESTED_REFUSED = [
  "features/billing/features/tax/services/tax.service.ts",
  "features/billing/tax/services/tax.service.ts",
  "services/features/billing/invoice.service.ts",
  "features/billing/services/sub/invoice.service.ts",
  "features/billing/transport/invoice.rest.ts",
  "features/billing/app/invoice.app.ts",
  "features/billing/tasks/backfill.task.ts",
  "features/billing/migrations/x-import.y.migration.ts",
  "features/billing/channels/invoice.channel.ts",
  "features/billing/index.ts",
  "features/Billing/services/invoice.service.ts",
];

function hasHome(path) {
  return PROCESS_PATTERNS.some((pattern) => pattern.test(path)) || RULES_PATTERN.test(path);
}

describe("given the closed process allowlist", () => {
  describe("when a path names one of the allowed homes", () => {
    /** @scenario "Only the allowed shape has a home" */
    it("accepts every home the message names", () => {
      expect(EXAMPLE.filter((path) => !hasHome(path))).toEqual([]);
    });
  });

  describe("when a converted module still carries its ported process composition", () => {
    /** @scenario "Only the allowed shape has a home" */
    it("admits app/<feature>-composition.build.ts and names it in the message", () => {
      expect(hasHome("app/annotation-composition.build.ts")).toBe(true);
      expect(PROCESS_HOMES).toContain("app/<feature>-composition.build.ts");
    });

    /** @scenario "Only the allowed shape has a home" */
    it("keeps the artifact scoped to app/, one per module", () => {
      expect(hasHome("annotation-composition.build.ts")).toBe(false);
      expect(hasHome("composition/annotation.build.ts")).toBe(false);
    });
  });

  describe("when a converted module declares its member record beside the app", () => {
    /** @scenario "Only the allowed shape has a home" */
    it("admits app/<feature>.members.ts and names it in the message", () => {
      expect(hasHome("app/annotation.members.ts")).toBe(true);
      expect(PROCESS_HOMES).toContain("app/<feature>.members.ts");
    });

    /** @scenario "Only the allowed shape has a home" */
    it("keeps the artifact scoped to app/ with the dotted suffix", () => {
      expect(hasHome("annotation.members.ts")).toBe(false);
      expect(hasHome("app/annotation-members.ts")).toBe(false);
      expect(hasHome("members/annotation.members.ts")).toBe(false);
    });
  });

  describe("when a concern nests its own services, rules, repositories and eventing", () => {
    /** @scenario "A concern may nest services, rules, repositories and eventing one level deep" */
    it("admits features/<concern>/ in front of those four homes and names it in the message", () => {
      expect(NESTED.filter((path) => !hasHome(path))).toEqual([]);
      expect(PROCESS_HOMES).toContain("features/<concern>/");
    });

    /** @scenario "Nesting stops at one level and leaves the other homes at the top" */
    it("refuses a second level, features/ inside a home, and a nested transport, app, task, migration, channel or index", () => {
      expect(NESTED_REFUSED.filter(hasHome)).toEqual([]);
    });

    /** @scenario "A nested rules, service or process-manager file gets the same checks as a top-level one" */
    it("keeps the service and rules patterns in step with the homes", () => {
      expect(RULES_PATTERN.test("features/billing/rules/invoice.rules.ts")).toBe(true);
      expect(RULES_PATTERN.test("features/billing/features/tax/rules/tax.rules.ts")).toBe(false);
      expect(SERVICE_MODULE_PATTERN.test("features/billing/services/invoice.service.ts")).toBe(
        true,
      );
      expect(
        PROCESS_MANAGER_SERVICE_PATTERN.test(
          "features/billing/services/invoice-process.service.ts",
        ),
      ).toBe(true);
      expect(stripFeaturePrefix("features/billing/services/invoice.service.ts")).toBe(
        "services/invoice.service.ts",
      );
      expect(stripFeaturePrefix("services/invoice.service.ts")).toBe("services/invoice.service.ts");
    });
  });

  describe("when a path names a folder the grammar closed", () => {
    /** @scenario "Only the allowed shape has a home" */
    it("refuses it and never names it in the message", () => {
      expect(REFUSED.filter(hasHome)).toEqual([]);
      for (const folder of ["ports/", "adapters/", "stores/", "fixtures/", "projections/"]) {
        expect(PROCESS_HOMES).not.toContain(folder);
      }
    });
  });
});
