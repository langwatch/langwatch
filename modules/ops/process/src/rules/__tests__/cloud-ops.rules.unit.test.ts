/**
 * @vitest-environment node
 * The capability decision: the switch AND a private key that pairs with the built-in public key.
 */
import { generateKeyPairSync } from "node:crypto";

import { CloudOpsKeyMismatchError } from "@langwatch/ops-contract";
import { describe, expect, it } from "vitest";

import { decideCloudOps } from "../cloud-ops.rules.ts";

function pair() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

const release = pair();
const stranger = pair();

describe("decideCloudOps", () => {
  describe("given the deployment did not ask", () => {
    /** @scenario "Cloud admin is on only when asked for and the licence key matches the release" */
    it("is off with no key, and off with the matching key", () => {
      const off = { asked: false, builtInPublicKey: release.publicKey };

      expect(decideCloudOps({ ...off, privateKey: void 0 })).toBe(false);
      expect(decideCloudOps({ ...off, privateKey: release.privateKey })).toBe(false);
    });
  });

  describe("given the deployment asked", () => {
    const asked = { asked: true, builtInPublicKey: release.publicKey };

    /** @scenario "Cloud admin is on only when asked for and the licence key matches the release" */
    it("is on with the key that pairs with the built-in public key", () => {
      expect(decideCloudOps({ ...asked, privateKey: release.privateKey })).toBe(true);
    });

    /** @scenario "Cloud admin is on only when asked for and the licence key matches the release" */
    it("accepts a key whose newlines arrive escaped, as an env value carries them", () => {
      const escaped = release.privateKey.replace(/\n/g, "\\n");

      expect(decideCloudOps({ ...asked, privateKey: escaped })).toBe(true);
    });

    /** @scenario "Cloud admin is on only when asked for and the licence key matches the release" */
    it("refuses boot with no key", () => {
      expect(() => decideCloudOps({ ...asked, privateKey: void 0 })).toThrow(
        CloudOpsKeyMismatchError,
      );
    });

    /** @scenario "Cloud admin is on only when asked for and the licence key matches the release" */
    it("refuses boot with a key that pairs with a different public key", () => {
      expect(() => decideCloudOps({ ...asked, privateKey: stranger.privateKey })).toThrow(
        CloudOpsKeyMismatchError,
      );
    });

    /** @scenario "Cloud admin is on only when asked for and the licence key matches the release" */
    it("refuses boot with a value that is not a key, without echoing it", () => {
      const attempt = () => decideCloudOps({ ...asked, privateKey: "not-a-key-secret-value" });

      expect(attempt).toThrow(CloudOpsKeyMismatchError);
      expect(attempt).not.toThrow(/secret-value/);
    });
  });
});
