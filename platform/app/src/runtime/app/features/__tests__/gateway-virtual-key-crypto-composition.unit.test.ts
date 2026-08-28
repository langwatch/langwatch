import { createHmac } from "node:crypto";
import { VirtualKeyCryptoAdapter, VirtualKeyCryptoError } from "@langwatch/gateway-server";
import { describe, expect, it } from "vitest";
import { createProcessVirtualKeyCrypto } from "../gateway-virtual-key-crypto.composition";

const VIRTUAL_KEY_PEPPER = "configured-virtual-key-pepper-32-bytes";

describe("virtual-key crypto process composition", () => {
  it("uses exactly the process LW_VIRTUAL_KEY_PEPPER value for resolve hashes", () => {
    const crypto = createProcessVirtualKeyCrypto({
      virtualKeyPepper: VIRTUAL_KEY_PEPPER,
    });
    const presented = VirtualKeyCryptoAdapter.mintSecret(1_735_000_000_000);
    const expectedHash = createHmac("sha256", VIRTUAL_KEY_PEPPER).update(presented).digest("hex");

    expect(crypto.hashSecret(presented)).toBe(expectedHash);
    expect(crypto.verifySecret(presented, expectedHash)).toBe(true);
  });

  it.each([void 0, ""])("retains pepper_missing for a %s process pepper", (pepper) => {
    const crypto = createProcessVirtualKeyCrypto({ virtualKeyPepper: pepper });
    const secret = VirtualKeyCryptoAdapter.mintSecret();

    expect(() => crypto.hashSecret(secret)).toThrow(
      expect.objectContaining({ code: "pepper_missing" } satisfies Partial<VirtualKeyCryptoError>),
    );
    expect(() => crypto.verifySecret(secret, "0".repeat(64))).toThrow(
      expect.objectContaining({ code: "pepper_missing" } satisfies Partial<VirtualKeyCryptoError>),
    );
  });
});
