import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The tenancy rail for SSO connections, asserted structurally.
 *
 * `connectionId` is caller input on every self-serve surface, and the tRPC
 * permission that guards those surfaces is checked against the CALLER'S OWN
 * `organizationId`. Nothing about a connection id says whose it is. So the
 * only thing standing between an administrator of one organization and
 * another organization's identity provider is that every verb remembers to
 * ask — and five of them did not, because the organization-blind resolver was
 * the shorter call.
 *
 * The behavioural half lives in `sso-self-serve.integration.test.ts`: those
 * verbs now refuse. This file is the half that keeps it fixed, because a
 * behavioural test only covers the verbs somebody thought to write a case
 * for, and the next verb is the one nobody will.
 *
 * The invariant: THERE IS ONE PLACE THAT RESOLVES A CONNECTION TO ACT ON IT,
 * and it takes an organization. In the service that is the only connection
 * read at all. In the guards two others remain, and they are named here
 * rather than counted away: `registerConnection` and `grandfatherConnection`
 * read to assert NON-existence — their `ALLOWED_FROM` is empty, so they act
 * on no existing connection and a second pass states nothing. Any other
 * method reading a connection fails this file.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) =>
  readFileSync(resolve(here, "..", file), "utf8");

const occurrences = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

/**
 * The body of a named method, brace-matched from its signature.
 *
 * The parameter list is skipped by PAREN depth first: every method here
 * destructures its argument, so the first `{` after the signature belongs to
 * the parameter pattern, not the body.
 */
function methodBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start === -1) throw new Error(`no method matching ${signature}`);

  let parens = 0;
  let i = source.indexOf("(", start);
  for (; i < source.length; i++) {
    if (source[i] === "(") parens++;
    if (source[i] === ")") {
      parens--;
      if (parens === 0) break;
    }
  }

  let depth = 0;
  for (let j = source.indexOf("{", i); j < source.length; j++) {
    if (source[j] === "{") depth++;
    if (source[j] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, j + 1);
    }
  }
  throw new Error(`unbalanced braces after ${signature}`);
}

/** Which methods in a file contain a given call. */
function methodsContaining(source: string, call: string): string[] {
  const names = [
    ...source.matchAll(/\n  (?:private |public )?(?:async )?(\w+)\(/g),
  ].map(([, name]) => name as string);
  return names.filter((name) => {
    try {
      const signature = [
        `  private async ${name}(`,
        `  async ${name}(`,
        `  ${name}(`,
      ].find((candidate) => source.includes(`\n${candidate}`));
      if (!signature) return false;
      return methodBody(source, signature).includes(call);
    } catch {
      return false;
    }
  });
}

describe("given the self-serve service", () => {
  const source = read("sso-self-serve.service.ts");

  describe("when a verb resolves the connection it is about to change", () => {
    it("has exactly one connection read, and it is the organization-checked one", () => {
      expect(occurrences(source, "reads.findConnection(")).toBe(1);
      expect(
        methodBody(source, "  private async requireOrganizationConnection("),
      ).toContain("reads.findConnection(");
    });

    it("keeps no organization-blind resolver for a verb to reach for", () => {
      // The deleted method. Its absence is the point: a verb cannot call the
      // short one if the short one does not exist.
      expect(source).not.toContain("private async requireConnection(");
    });

    it("refuses a connection that is not the caller's before it returns one", () => {
      const resolver = methodBody(
        source,
        "  private async requireOrganizationConnection(",
      );
      expect(resolver).toContain("state.organizationId !== organizationId");
      // One sentence for both misses, or the refusal is an existence oracle
      // for connection ids — which the sign-in router hands out unauthenticated.
      expect(occurrences(resolver, "throw new SsoDomainProofNotFoundError(")).toBe(
        1,
      );
    });
  });

  describe("when a verb takes a connection id from its caller", () => {
    it("takes the organization that must own it in the same breath", () => {
      // Every public verb's destructured parameter list, up to the closing
      // brace of the object pattern.
      const verbs = [...source.matchAll(/\n  async (\w+)\(\{([^}]*)\}/g)].map(
        ([, name, params]) => ({ name, params: params ?? "" }),
      );
      expect(verbs.length).toBeGreaterThan(5);

      const blind = verbs
        .filter(
          (verb) =>
            /\bconnectionId\b/.test(verb.params) &&
            !/\borganizationId\b/.test(verb.params),
        )
        .map((verb) => verb.name);

      expect(blind).toEqual([]);
    });
  });
});

describe("given the connection guards", () => {
  const source = read("sso-connection-guards.ts");

  describe("when a command names the connection it acts on", () => {
    it("reads a connection only to create one or to guard one", () => {
      // `require` is the guarded read: it checks ownership, then the
      // transition. The other two are the creation verbs, whose ALLOWED_FROM
      // is empty — they read to assert NON-existence, so that a second pass
      // states nothing, and they act on no existing connection at all.
      expect(
        methodsContaining(source, "connections.findConnection(").sort(),
      ).toEqual(["grandfatherConnection", "registerConnection", "require"]);
      expect(methodBody(source, "  private async require(")).toContain(
        "connections.findConnection(",
      );
    });

    it("checks the command's organization owns it before the transition", () => {
      const body = methodBody(source, "  private async require(");
      const ownership = body.indexOf(
        "state.organizationId !== data.organizationId",
      );
      const transition = body.indexOf("ALLOWED_FROM[command]");
      expect(ownership).toBeGreaterThan(-1);
      // Ownership first: "that is not yours" must not be answerable as "that
      // transition is not allowed from your state", which is a different fact
      // about somebody else's connection.
      expect(ownership).toBeLessThan(transition);
    });

    it("answers a foreign connection exactly as it answers a missing one", () => {
      const body = methodBody(source, "  private async require(");
      const refusals = [
        ...body.matchAll(/does not exist`,\n\s*\);/g),
      ];
      expect(refusals.length).toBe(2);
    });
  });
});
