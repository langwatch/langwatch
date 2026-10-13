/**
 * The deployment-secret door reads its bearer as RFC 6750 spells it (Q52).
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */
import { describe, expect, it } from "vitest";

import { BearerIdentity } from "../bearer-identity.ts";

const CONFIGURED = "deployment-marker";

function present(authorization: string | null, configured = CONFIGURED) {
  const door = BearerIdentity.create({ name: "operator", token: configured });
  const request = new Request("http://door.test/", {
    headers: authorization === null ? {} : { authorization },
  });

  try {
    return { admitted: door.identify({ request }) };
  } catch (failure) {
    return { refused: (failure as { code?: string; httpStatus?: number }) ?? {} };
  }
}

describe("the deployment-secret door", () => {
  describe("when the secret follows the Bearer scheme", () => {
    /** @scenario "The deployment-secret door reads its bearer as RFC 6750 spells it" */
    it("admits the scheme in any letter case and with whitespace around it", () => {
      for (const header of [
        `Bearer ${CONFIGURED}`,
        `bearer ${CONFIGURED}`,
        `BEARER ${CONFIGURED}`,
        `  Bearer   ${CONFIGURED}  `,
        `Bearer\t${CONFIGURED}`,
      ]) {
        expect(present(header).admitted, header).toEqual({
          actor: null,
          scope: null,
          internal: { type: "internalSecret", secretName: "operator" },
        });
      }
    });
  });

  describe("when the secret arrives without the Bearer scheme", () => {
    /** @scenario "The deployment-secret door reads its bearer as RFC 6750 spells it" */
    it("refuses a bare secret, another scheme, a scheme alone and no header as unverified", () => {
      for (const header of [
        CONFIGURED,
        `Basic ${CONFIGURED}`,
        `Bearer${CONFIGURED}`,
        `Bearer Bearer ${CONFIGURED}`,
        "Bearer ",
        null,
      ]) {
        expect(present(header).refused, String(header)).toMatchObject({
          code: "unauthorized",
          httpStatus: 401,
        });
      }
    });
  });

  describe("when the configured secret carries whitespace", () => {
    /** @scenario "The deployment-secret door reads its bearer as RFC 6750 spells it" */
    it("compares it trimmed", () => {
      expect(present(`Bearer ${CONFIGURED}`, `  ${CONFIGURED}\n`).admitted).toBeDefined();
    });
  });
});
