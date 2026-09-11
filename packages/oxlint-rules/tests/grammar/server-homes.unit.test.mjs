import { describe, expect, it } from "vitest";
import {
  RULES_PATTERN,
  SERVER_HOMES,
  SERVER_PATTERNS,
} from "../../grammar/feature-layout-policy.mjs";

// The message a refused file prints is the allowlist read aloud. If the two
// drift, the linter refuses a file and then names a folder it would refuse
// again, which is how an agent gets coached into the shape being deleted.

const EXAMPLE = [
  "index.ts",
  "annotation.server.ts",
  "app/annotation.app.ts",
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
];

const REFUSED = [
  "ports/annotation.port.ts",
  "adapters/postgres.annotation.adapter.ts",
  "stores/annotation.store.ts",
  "fixtures/annotation.fixture.ts",
  "transport/api-rest/annotation.api.ts",
];

function hasHome(path) {
  return SERVER_PATTERNS.some((pattern) => pattern.test(path)) || RULES_PATTERN.test(path);
}

describe("given the closed server allowlist", () => {
  describe("when a path names one of the allowed homes", () => {
    /** @scenario "Only the allowed shape has a home" */
    it("accepts every home the message names", () => {
      expect(EXAMPLE.filter((path) => !hasHome(path))).toEqual([]);
    });
  });

  describe("when a path names a folder the grammar closed", () => {
    /** @scenario "Only the allowed shape has a home" */
    it("refuses it and never names it in the message", () => {
      expect(REFUSED.filter(hasHome)).toEqual([]);
      for (const folder of ["ports/", "adapters/", "stores/", "fixtures/", "projections/"]) {
        expect(SERVER_HOMES).not.toContain(folder);
      }
    });
  });
});
