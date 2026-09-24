import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { SecretsChain } from "../chain.ts";
import { refuseDoubleClaims, type SecretsOwner } from "../claims.ts";
import { secretLogRedactPaths } from "../redact.ts";
import { SecretsResolver } from "../resolver.ts";
import { Secret } from "../secret.ts";
import {
  AbsentSecretError,
  SealedSecretsError,
  SecretClaimedTwiceError,
  SecretsPreflightError,
  UndeclaredSecretError,
} from "../secrets.errors.ts";
import { sessionSecret } from "../shared-secrets.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secrets-"));
const dotenv = path.join(dir, ".env");
fs.writeFileSync(dotenv, 'FILE_ONLY="from-file"\nSHADOWED=file-loses\n# COMMENTED=nope\n');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const chain = SecretsChain.start({ environment: { SHADOWED: "env-wins", IN_ENV: "abc" } })
  .withEnv()
  .withFile(dotenv);

describe("the chain", () => {
  it("answers one id at a time, front to back, first adapter wins", async () => {
    await expect(chain.fetch("SHADOWED")).resolves.toBe("env-wins");
    await expect(chain.fetch("FILE_ONLY")).resolves.toBe("from-file");
    await expect(chain.fetch("COMMENTED")).resolves.toBeUndefined();
    await expect(chain.fetch("NOWHERE")).resolves.toBeUndefined();
  });

  it("treats a missing dotenv file as ordinary absence", async () => {
    const bare = SecretsChain.start({ environment: {} }).withFile(path.join(dir, "absent"));
    await expect(bare.fetch("ANYTHING")).resolves.toBeUndefined();
  });

  it("leaves withOnePassword inert without an account", async () => {
    const same = chain.withOnePassword(undefined).withOnePassword("  ");
    await expect(same.fetch("IN_ENV")).resolves.toBe("abc");
  });
});

describe("the scoped resolver", () => {
  const inEnv = Secret.load("IN_ENV");
  const missing = Secret.load("NOWHERE");
  const maybe = Secret.load("NOWHERE_EITHER", { optional: true });

  it("hands the value to the closure and only the collaborator escapes", async () => {
    const scoped = SecretsResolver.over(chain).scopeTo("github", [inEnv]);
    const collaborator = await scoped.into(inEnv, (value) => ({ holds: value.length }));
    expect(collaborator).toEqual({ holds: 3 });
  });

  it("refuses a handle the owner never declared, naming both", async () => {
    const scoped = SecretsResolver.over(chain).scopeTo("github", [inEnv]);
    await expect(scoped.into(missing, (v) => v)).rejects.toThrowError(UndeclaredSecretError);
  });

  it("refuses a required absence by its one id, passes an optional one as undefined", async () => {
    const scoped = SecretsResolver.over(chain).scopeTo("x", [missing, maybe]);
    await expect(scoped.into(missing, (v) => v)).rejects.toThrowError(AbsentSecretError);
    await expect(scoped.into(maybe, (v) => v)).resolves.toBeUndefined();
  });

  it("seals: after boot the capability is gone", async () => {
    const resolver = SecretsResolver.over(chain);
    const scoped = resolver.scopeTo("github", [inEnv]);
    resolver.seal();
    await expect(scoped.into(inEnv, (v) => v)).rejects.toThrowError(SealedSecretsError);
  });
});

describe("the preflight", () => {
  it("names every unanswerable required handle at once, ignores optional ones", async () => {
    const resolver = SecretsResolver.over(chain);
    const handles = [
      Secret.load("IN_ENV"),
      Secret.load("MISSING_ONE"),
      Secret.load("MISSING_TWO"),
      Secret.load("MISSING_OPTIONAL", { optional: true }),
    ];

    const failure = await resolver.preflight(handles).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(SecretsPreflightError);
    expect((failure as SecretsPreflightError).missing).toEqual(["MISSING_ONE", "MISSING_TWO"]);

    await expect(resolver.preflight([Secret.load("IN_ENV")])).resolves.toBeUndefined();
  });
});

describe("one credential, declared by two owners", () => {
  it("refuses one credential declared separately by two owners, naming both", () => {
    const owners: readonly SecretsOwner[] = [
      { name: "github", secrets: { signingKey: Secret.load("CREDENTIALS_SECRET") } },
      { name: "secret", secrets: { encryptionKey: Secret.load("CREDENTIALS_SECRET") } },
    ];

    const failure = (() => {
      try {
        refuseDoubleClaims(owners);
        return undefined;
      } catch (error: unknown) {
        return error;
      }
    })();

    expect(failure).toBeInstanceOf(SecretClaimedTwiceError);
    expect((failure as SecretClaimedTwiceError).id).toBe("CREDENTIALS_SECRET");
    expect((failure as SecretClaimedTwiceError).owners).toEqual(["github", "secret"]);
  });

  /** @scenario "Two owners holding the one shared handle both boot" */
  it("admits two owners holding the one exported handle", () => {
    const owners: readonly SecretsOwner[] = [
      { name: "auth", secrets: { session: sessionSecret } },
      { name: "automation", secrets: { unsubscribeSigning: sessionSecret } },
    ];

    expect(() => refuseDoubleClaims(owners)).not.toThrow();
  });

  /** @scenario "A fresh handle for a shared id still refuses, naming both owners" */
  it("refuses a fresh handle for a shared id, naming the holder and the newcomer", () => {
    const owners: readonly SecretsOwner[] = [
      { name: "auth", secrets: { session: sessionSecret } },
      { name: "automation", secrets: { signing: sessionSecret } },
      { name: "rogue", secrets: { session: Secret.load("NEXTAUTH_SECRET", { optional: true }) } },
    ];

    const failure = (() => {
      try {
        refuseDoubleClaims(owners);
        return undefined;
      } catch (error: unknown) {
        return error;
      }
    })();

    expect(failure).toBeInstanceOf(SecretClaimedTwiceError);
    expect(failure).toMatchObject({ id: "NEXTAUTH_SECRET", owners: ["auth", "rogue"] });
  });

  it("admits one owner declaring many secrets of its own", () => {
    const owners: readonly SecretsOwner[] = [
      { name: "secret", secrets: { cipher: Secret.load("CREDENTIALS_SECRET") } },
      { name: "auth", secrets: { session: Secret.load("NEXTAUTH_SECRET") } },
      { name: "quiet", secrets: {} },
      { name: "silent" },
    ];

    expect(() => refuseDoubleClaims(owners)).not.toThrow();
  });

  it("derives log redaction from the handles a process declared, not a registry", () => {
    const paths = secretLogRedactPaths([Secret.load("A_KEY"), Secret.load("A_KEY")]);

    expect(paths).toEqual(["A_KEY", "*.A_KEY"]);
  });
});
