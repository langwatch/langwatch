/**
 * The repository-owned loader.
 *
 * Its `@integration` scenario belongs to the chart runtime, which wires the
 * loader into a live Vega view; what is provable here is the contract that
 * scenario depends on — every method refuses, none of them reaches the network,
 * and the refusal never repeats a credential back.
 *
 * Node environment on purpose — see `validateVegaLiteSpec.unit.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";

import {
  createNoNetworkVegaLoader,
  GovernedVegaLoadBlockedError,
  redactResourceReference,
} from "../noNetworkVegaLoader";

/**
 * Runs an attempt that must refuse, and hands back the refusal it raised.
 * Throwing when the attempt resolves keeps a loader that silently succeeded
 * from reading as a loader that refused.
 */
const refusalFrom = async (
  attempt: () => Promise<unknown>,
): Promise<GovernedVegaLoadBlockedError> => {
  try {
    await attempt();
  } catch (raised) {
    if (raised instanceof GovernedVegaLoadBlockedError) return raised;
    throw raised;
  }
  throw new Error("the loader resolved the load instead of refusing it");
};

describe("the no-network Vega loader", () => {
  describe("given a spec that slipped past static validation with a loadable resource", () => {
    describe("when the view asks the loader for it", () => {
      it("refuses every method, names the blocked resource, and issues no request", async () => {
        const reachedTheNetwork = vi.fn(() => {
          throw new Error("the loader must not reach the network");
        });
        vi.stubGlobal("fetch", reachedTheNetwork);
        const loader = createNoNetworkVegaLoader();

        try {
          // Thunks rather than promises: four already-rejected promises sitting
          // in an array would be unhandled until the loop reached them.
          const attempts: [string, () => Promise<unknown>][] = [
            ["load", () => loader.load("https://exfiltrate.example/rows.json")],
            [
              "sanitize",
              () => loader.sanitize("https://exfiltrate.example/rows.json"),
            ],
            ["http", () => loader.http("https://exfiltrate.example/rows.json")],
            ["file", () => loader.file("/etc/passwd")],
          ];

          for (const [method, attempt] of attempts) {
            const error = await refusalFrom(attempt);
            expect(error.detail.rule).toBe("loader.blocked");
            expect(error.detail.code).toBe("loader-blocked");
            expect(error.detail.path).toBe("/");
            expect(error.detail.meta?.method).toBe(method);
          }

          const localFile = await refusalFrom(() => loader.file("/etc/shadow"));
          expect(localFile.message).toContain("/etc/shadow");
        } finally {
          vi.unstubAllGlobals();
        }

        expect(reachedTheNetwork).not.toHaveBeenCalled();
      });

      it("never repeats a credential, token, or fragment back in the refusal", async () => {
        const withSecrets =
          "https://user:hunter2@exfiltrate.example/rows.json?token=SECRET#anchor";

        const raised = await refusalFrom(() =>
          createNoNetworkVegaLoader().load(withSecrets),
        );

        for (const secret of [
          "hunter2",
          "SECRET",
          "token=",
          "anchor",
          "user:",
        ]) {
          expect(raised.message).not.toContain(secret);
          expect(JSON.stringify(raised.detail)).not.toContain(secret);
        }
        expect(raised.message).toContain("exfiltrate.example/rows.json");
      });

      it("keeps a reference it cannot parse readable while still dropping its query", () => {
        expect(redactResourceReference("data/local.json?token=SECRET")).toBe(
          "data/local.json",
        );
        expect(redactResourceReference("not a url at all")).toBe(
          "not a url at all",
        );
      });

      it("hands each view its own loader so one can never mutate another's", () => {
        expect(createNoNetworkVegaLoader()).not.toBe(
          createNoNetworkVegaLoader(),
        );
      });
    });
  });
});
