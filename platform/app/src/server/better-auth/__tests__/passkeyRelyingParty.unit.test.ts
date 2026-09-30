import { describe, expect, it } from "vitest";
import { passkeyRelyingParty } from "../passkeyRelyingParty";

/**
 * Which address a passkey is bound to.
 *
 * The two halves are deliberately different shapes and the tests say so: the
 * relying party id is a bare domain the browser matches a stored credential
 * against, so a port on it matches nothing, while the expected origin is what
 * the browser actually signed, port included and path excluded.
 */

const PUBLIC = "https://lw7631.boxd.sh";
const INTERNAL = "http://localhost:5560";

describe("passkeyRelyingParty", () => {
  describe("given both addresses", () => {
    /** @scenario "The passkey relying party is the deployment's public address" */
    it("binds to the public address rather than the internal one", () => {
      expect(
        passkeyRelyingParty({ baseHost: PUBLIC, nextAuthUrl: INTERNAL }),
      ).toEqual({ rpID: "lw7631.boxd.sh", origin: PUBLIC });
    });
  });

  describe("given only the internal address", () => {
    /**
     * A self-hosted install on one hostname sets neither behind a proxy nor
     * apart, so the fallback has to be the address it does name.
     */
    it("falls back to it", () => {
      expect(passkeyRelyingParty({ nextAuthUrl: PUBLIC })).toEqual({
        rpID: "lw7631.boxd.sh",
        origin: PUBLIC,
      });
    });
  });

  describe("given an address carrying a port", () => {
    it("leaves the port off the relying party id", () => {
      expect(passkeyRelyingParty({ baseHost: INTERNAL })?.rpID).toBe(
        "localhost",
      );
    });

    it("keeps the port on the origin", () => {
      expect(passkeyRelyingParty({ baseHost: INTERNAL })?.origin).toBe(
        "http://localhost:5560",
      );
    });
  });

  describe("given an address carrying a path", () => {
    it("drops the path and any trailing slash from the origin", () => {
      expect(
        passkeyRelyingParty({ baseHost: "https://acme.langwatch.ai/app/" }),
      ).toEqual({
        rpID: "acme.langwatch.ai",
        origin: "https://acme.langwatch.ai",
      });
    });

    it("drops a bare trailing slash too", () => {
      expect(
        passkeyRelyingParty({ baseHost: "https://acme.langwatch.ai/" })?.origin,
      ).toBe("https://acme.langwatch.ai");
    });
  });

  describe("given nothing usable", () => {
    /**
     * Null rather than a throw, and null rather than a guess: the caller
     * hands the plugin its own default back, which is a worse passkey than a
     * process that will not boot.
     */
    it("resolves nothing when neither address is set", () => {
      expect(passkeyRelyingParty({})).toBeNull();
      expect(
        passkeyRelyingParty({ baseHost: null, nextAuthUrl: undefined }),
      ).toBeNull();
      expect(passkeyRelyingParty({ baseHost: "   " })).toBeNull();
    });

    it("resolves nothing when neither address parses", () => {
      expect(
        passkeyRelyingParty({
          baseHost: "not an address",
          nextAuthUrl: "also not one",
        }),
      ).toBeNull();
    });

    it("falls through an unparseable public address to the internal one", () => {
      expect(
        passkeyRelyingParty({ baseHost: "not an address", nextAuthUrl: PUBLIC })
          ?.rpID,
      ).toBe("lw7631.boxd.sh");
    });
  });
});
