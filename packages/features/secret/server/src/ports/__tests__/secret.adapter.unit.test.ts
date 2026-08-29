import { describe, expect, it } from "vitest";
import { PostgresSecretAdapter } from "../../adapters/postgres.secret.adapter";
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
      database: {},
      encryption: new StubSecretEncryption(),
      reservedNames: [],
    });

    expect(adapter.build()).toBe(adapter.build());
  });
});
