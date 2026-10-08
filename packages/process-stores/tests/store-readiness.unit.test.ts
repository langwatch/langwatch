/**
 * The readiness query a process's opened stores answer, and the refusal naming one that does not.
 * Spec: specs/server/process-readiness.feature
 */
import { describe, expect, it } from "vitest";

import { buildProcessStores, hostedStores } from "../src/create-members.ts";
import type { ProcessConfig } from "../src/index.ts";

/** Port 1 refuses every connection, so a query fails fast rather than waiting on a timeout. */
function config(overrides: Partial<ProcessConfig> = {}): ProcessConfig {
  return {
    processName: "store-readiness-test",
    encryptionKey: Buffer.alloc(32, 7).toString("hex"),
    secrets: {},
    rateLimit: { requests: 10, seconds: 60 },
    database: { url: "postgresql://postgres@127.0.0.1:1/langwatch" },
    ...overrides,
  };
}

describe("given a process whose opened PostgreSQL cannot be reached", () => {
  describe("when readiness asks the stores", () => {
    /** @scenario "A store that cannot be reached is named in the refusal" */
    it("fails naming the prisma store", async () => {
      const members = buildProcessStores({ config: config() }).members;
      try {
        members.read("prisma");

        await expect(members.answer?.()).rejects.toMatchObject({
          code: "store_not_answering",
          member: "prisma",
        });
      } finally {
        await members.close();
      }
    });
  });
});

describe("given a process that opened no store client", () => {
  describe("when readiness asks the stores", () => {
    it("answers without asking the store it never opened", async () => {
      const members = buildProcessStores({ config: config() }).members;
      try {
        await expect(members.answer?.()).resolves.toBeUndefined();
      } finally {
        await members.close();
      }
    });
  });
});

describe("given the stores hosted on a server", () => {
  describe("when the server asks the hosted component whether it is ready", () => {
    it("asks the stores the process opened", async () => {
      const members = buildProcessStores({ config: config() }).members;
      try {
        members.read("prisma");

        await expect(hostedStores(members).ready?.()).rejects.toMatchObject({
          code: "store_not_answering",
        });
      } finally {
        await members.close();
      }
    });
  });
});
