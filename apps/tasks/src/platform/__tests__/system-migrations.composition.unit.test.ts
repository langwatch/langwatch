import {
  IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
  IDENTITY_SECRET_HEAL_MIGRATION_NAME,
  IdentityEventingPort,
} from "@langwatch/identity-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it } from "vitest";
import { registeredUserMigrations } from "../system-migrations.composition.ts";

/** This process produces commands; nothing here appends during composition. */
class StubIdentityEventing extends IdentityEventingPort {
  tryPipelineCommand(): Promise<{ send(data: unknown): Promise<unknown> } | null> {
    return Promise.resolve(null);
  }
}

function compose() {
  return registeredUserMigrations({
    database: {} as PrismaClient,
    eventing: new StubIdentityEventing(),
  });
}

describe("the tasks process's user-rooted migration registry", () => {
  describe("when the system-migrations pass composes it", () => {
    /** @scenario "Each migration presents a title and a description, in running order" */
    it("names the identifier backfill and the secret heal, in that order", () => {
      expect(compose().map((migration) => migration.name)).toEqual([
        IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
        IDENTITY_SECRET_HEAL_MIGRATION_NAME,
      ]);
    });

    /** @scenario "Each migration presents a title and a description, in running order" */
    it("gives every registered migration a title and a description", () => {
      for (const migration of compose()) {
        expect(migration.title.length).toBeGreaterThan(0);
        expect(migration.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe("given neither migration has been released", () => {
    it("keeps both paced by enrollment and inert on self-hosted installations", () => {
      for (const migration of compose()) {
        expect(migration.enrolledAutomatically).toBe(false);
        expect(migration.runsAutomaticallyOnSelfHosted).toBe(false);
      }
    });
  });
});
