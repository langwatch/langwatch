/**
 * @vitest-environment node
 * Which connection of a migration pair an identifier belongs to, when the
 * identifier was adopted before connections annotated themselves.
 * @see specs/identity/sso-idp-termination.feature
 */
import { describe, expect, it } from "vitest";

import { identifierBelongsToMigrationConnection } from "../sso-migration.rules.ts";

const LEGACY = {
  connectionId: "ssoc_legacy",
  source: "legacy-grandfathered",
  idpMetadata: { providerId: "waad|acme-connection" },
};

const REPLACEMENT = {
  connectionId: "ssoc_replacement",
  source: "self-serve",
  idpMetadata: { providerId: "acme-okta" },
};

const identifier = (
  over: Partial<{
    connectionId: string | null;
    providerId: string | null;
    providerAccountId: string | null;
  }> = {},
) => ({ connectionId: null, providerId: null, providerAccountId: null, ...over });

describe("given an identifier with no connection annotation", () => {
  /** @scenario "Legacy adoption evidence keeps sibling providers separate" */
  it("counts a brokered subject whose prefix names the legacy connection", () => {
    expect(
      identifierBelongsToMigrationConnection({
        identifier: identifier({
          providerId: "auth0",
          providerAccountId: "waad|acme-connection|user-1",
        }),
        connection: LEGACY,
      }),
    ).toBe(true);
  });

  /** @scenario "Legacy adoption evidence keeps sibling providers separate" */
  it("does not count a sibling connection behind the same broker", () => {
    expect(
      identifierBelongsToMigrationConnection({
        identifier: identifier({
          providerId: "auth0",
          providerAccountId: "waad|rival-connection|user-1",
        }),
        connection: LEGACY,
      }),
    ).toBe(false);
  });

  it("does not count a local credential as the legacy provider's", () => {
    expect(
      identifierBelongsToMigrationConnection({
        identifier: identifier({ providerId: "credential", providerAccountId: "user-1" }),
        connection: LEGACY,
      }),
    ).toBe(false);
  });

  it("counts a direct connection's subject by the id its rows are keyed under", () => {
    expect(
      identifierBelongsToMigrationConnection({
        identifier: identifier({
          providerId: REPLACEMENT.connectionId,
          providerAccountId: "sub_1",
        }),
        connection: REPLACEMENT,
      }),
    ).toBe(true);
  });
});

describe("given an identifier that names its connection", () => {
  it("answers from the annotation and nothing else", () => {
    expect(
      identifierBelongsToMigrationConnection({
        identifier: identifier({
          connectionId: "ssoc_elsewhere",
          providerId: "auth0",
          providerAccountId: "waad|acme-connection|user-1",
        }),
        connection: LEGACY,
      }),
    ).toBe(false);
  });
});
