import { describe, expect, it } from "vitest";
import { PostgresSecretAdapter } from "../src/adapters/postgres.secret.adapter";
import { SecretEncryptionPort } from "../src/ports/secret.port";

class StubSecretEncryption extends SecretEncryptionPort {
  encrypt(value: string): string {
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
