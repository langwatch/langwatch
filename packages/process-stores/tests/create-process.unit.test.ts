/**
 * One statement for what a process is. Nothing here opens a socket: the process names no datastore,
 * so the only members it can answer with are the ones a caller hands in and the ones built from
 * config alone.
 */
import { describe, expect, it } from "vitest";

import { buildProcessStores, MemberSuppliedUndefinedError } from "../src/create-members.ts";
import type { ProcessConfig } from "../src/index.ts";

/** A process that named no datastore at all. */
function config(): ProcessConfig {
  return {
    processName: "test",
    encryptionKey: Buffer.alloc(32, 7).toString("hex"),
    secrets: {},
    rateLimit: { requests: 10, seconds: 60 },
  };
}

describe("given a process stated with createProcess", () => {
  describe("when the caller hands a member in as undefined", () => {
    it("refuses by name rather than building the real client", () => {
      expect(
        () => buildProcessStores({ config: config(), members: { clock: undefined } }).members,
      ).toThrow(MemberSuppliedUndefinedError);
    });
  });
});
