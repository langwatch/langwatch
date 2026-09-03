import { describe, expect, it } from "vitest";
import {
  PostgresSecretAdapter,
  type PostgresSecretAdapterOptions,
} from "../../adapters/postgres.secret.adapter";
import { SecretEncryptionPort } from "../secret.port";

class StubSecretEncryption extends SecretEncryptionPort {
  encrypt(value: string): string {
    return value;
  }

  decrypt(value: string): string {
    return value;
  }
}

describe("PostgresSecretAdapter", () => {
  it("memoizes the process-owned service and repository graph", () => {
    const adapter = PostgresSecretAdapter.create({
      // Never queried: this scenario is about the graph being built once. The
      // cast is the test's own, and the seam it goes through is typed — which
      // is what made this line fail to compile when the `object` seam went.
      database: {} as PostgresSecretAdapterOptions["database"],
      encryption: new StubSecretEncryption(),
      reservedNames: [],
    });

    expect(adapter.build()).toBe(adapter.build());
  });
});
