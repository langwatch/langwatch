import { Secret, SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { createApp } from "../application.ts";
import { defineServerModule, type FeatureSetup } from "../feature-installer.ts";
import { moduleApi } from "../module-api-token.ts";

interface SessionIdentity {
  accepts(candidate: string): boolean;
}

const SessionIdentity = moduleApi<SessionIdentity>()("auth");
const sessionKey = Secret.load("TEST_SESSION_KEY");

class SessionApp implements SessionIdentity {
  static readonly contract = SessionIdentity;
  static readonly dependencies = {};
  static readonly secrets = { session: sessionKey };

  readonly #key: string;

  private constructor(key: string) {
    this.#key = key;
  }

  static create({ secrets }: FeatureSetup<{}, unknown, undefined>): Promise<SessionApp> {
    return secrets.into(sessionKey, (key) => new SessionApp(key));
  }

  accepts(candidate: string): boolean {
    return candidate === this.#key;
  }
}

const auth = defineServerModule("auth").withApp(SessionApp).build();

class UndeclaredSessionApp {
  static readonly contract = SessionIdentity;
  static readonly dependencies = {};

  static create(setup: FeatureSetup<{}, unknown, undefined>): Promise<SessionApp> {
    return SessionApp.create(setup);
  }
}

function resolver() {
  return SecretsResolver.over(
    SecretsChain.start({ environment: { TEST_SESSION_KEY: "fixture-key" } }).withEnv(),
  );
}

describe("application secret declarations", () => {
  /** @scenario "Declared module secrets survive application registration" */
  it.each(["api", "worker"] as const)("constructs the declared identity for %s", async (role) => {
    const secrets = resolver();
    const runtime = await createApp({
      role,
      secrets: (owner, declared) => secrets.scopeTo(owner, declared),
    })
      .withModules([auth])
      .boot();

    try {
      const identity = runtime.module(auth).provided;
      expect(identity.accepts("fixture-key")).toBe(true);
      expect(identity.accepts("another-key")).toBe(false);
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "An available secret remains inaccessible without a module declaration" */
  it("refuses an undeclared handle even when the chain contains its value", async () => {
    const secrets = resolver();
    const undeclared = defineServerModule("auth").withApp(UndeclaredSessionApp).build();

    await expect(
      createApp({
        role: "worker",
        secrets: (owner, declared) => secrets.scopeTo(owner, declared),
      })
        .withModules([undeclared])
        .boot(),
    ).rejects.toMatchObject({ code: "secret_undeclared" });
  });
});
