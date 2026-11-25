/**
 * @see specs/upgrade/upgrade-command.feature
 */
import { afterAll, describe, expect, it, vi } from "vitest";

// Runs before the import below: the config reads DATABASE_URL as it loads.
const OPERATOR_URL = "postgresql://operator@db.invalid:5432/langwatch";
const previous = vi.hoisted(() => {
  const before = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://operator@db.invalid:5432/langwatch";
  return before;
});

import config from "../../prisma.config.ts";

afterAll(() => {
  if (previous === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous;
});

describe("the prisma-client Prisma config", () => {
  describe("when DATABASE_URL is set in the operator's shell", () => {
    /** @scenario "The Prisma config where the refusal sends the operator carries DATABASE_URL" */
    it("carries it as the datasource url, so prisma migrate resolve runs here", () => {
      expect(config.datasource?.url).toBe(OPERATOR_URL);
    });
  });
});
