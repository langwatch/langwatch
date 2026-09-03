import { describe, expect, it } from "vitest";
import { ApiInstanceAdminKeyAdapter } from "../api-instance-admin-key.adapter";

function adapterFor(instanceAdminApiKey: string | undefined): ApiInstanceAdminKeyAdapter {
  return ApiInstanceAdminKeyAdapter.create({ config: { instanceAdminApiKey } });
}

describe("ApiInstanceAdminKeyAdapter", () => {
  describe("given the deployment configured a credential", () => {
    it("answers with the configured key", () => {
      expect(adapterFor("instance-admin-secret").read()).toBe("instance-admin-secret");
    });

    it("trims the surrounding whitespace a shell export leaves behind", () => {
      expect(adapterFor("  instance-admin-secret\n").read()).toBe("instance-admin-secret");
    });

    it("answers the same key on every read, so a family may resolve it per request", () => {
      const adapter = adapterFor("instance-admin-secret");

      expect([adapter.read(), adapter.read()]).toEqual([
        "instance-admin-secret",
        "instance-admin-secret",
      ]);
    });
  });

  describe("given the deployment configured no credential", () => {
    it("answers with nothing when the variable is unset", () => {
      expect(adapterFor(undefined).read()).toBeUndefined();
    });

    it("answers with nothing when the variable is exported blank", () => {
      expect(adapterFor("").read()).toBeUndefined();
    });

    it("answers with nothing when the variable holds only whitespace", () => {
      expect(adapterFor("   \t \n ").read()).toBeUndefined();
    });
  });
});
