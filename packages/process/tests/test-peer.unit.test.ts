import { describe, expect, it } from "vitest";

import { DuplicateProviderError } from "../src/boot-errors.ts";
import { bootInstalledProcess } from "../src/boot-installed-process.ts";
import { testPeer } from "../src/testing.ts";
import { memberSourceOf } from "./member-source.ts";
import { peerModule, ProjectApi, projectModule } from "./process-supply.fixtures.ts";

const standIn: ProjectApi = { getById: (id) => `stand-in:${id}` };

describe("given a module whose peer is not installed", () => {
  describe("when the boot is handed a test peer for that Api", () => {
    /** @scenario "An installation test stands in for a peer it does not install" */
    it("reads the stand-in and answers the Api by its token with it", async () => {
      const runtime = await bootInstalledProcess({
        role: "api",
        modules: [peerModule],
        config: {},
        stores: memberSourceOf({}),
        peers: [testPeer({ token: ProjectApi, instance: standIn })],
      });

      try {
        expect(runtime.module(peerModule).provided.read("one")).toBe("stand-in:one");
        expect(runtime.service(ProjectApi)).toBe(standIn);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the peer's module is installed as well", () => {
    /** @scenario "A test peer cannot replace a peer that is installed" */
    it("refuses by name, the Api provided more than once", async () => {
      const booting = bootInstalledProcess({
        role: "api",
        modules: [peerModule, projectModule],
        config: {},
        stores: memberSourceOf({}),
        peers: [testPeer({ token: ProjectApi, instance: standIn })],
      });

      await expect(booting).rejects.toBeInstanceOf(DuplicateProviderError);
      await expect(booting).rejects.toThrow(/project is provided more than once/);
    });
  });
});
