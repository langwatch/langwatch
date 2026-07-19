import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { blocked, classify, isPublicAddress, type Category } from "./index";

/**
 * The corpus is the single source of truth shared with the Go pkg/ssrf tests.
 * Locating it by walking up to go.mod (rather than a fixed ../../../ path) keeps
 * this test from breaking if the package is ever moved.
 */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "go.mod"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("could not locate repo root (no go.mod found while walking up)");
}

interface AddressVector {
  addr: string;
  category: Category;
  note: string;
}

const corpusPath = join(repoRoot(), "pkg", "ssrf", "testdata", "address_vectors.json");
const vectors = (
  JSON.parse(readFileSync(corpusPath, "utf8")) as { vectors: AddressVector[] }
).vectors;

describe("@langwatch/ssrf shared conformance corpus", () => {
  it("loads a non-empty corpus", () => {
    expect(vectors.length).toBeGreaterThan(0);
  });

  describe("given each shared address vector", () => {
    for (const v of vectors) {
      describe(`when classifying ${v.addr} (${v.note})`, () => {
        it(`classifies it as ${v.category}`, () => {
          expect(classify(v.addr)).toBe(v.category);
        });

        it("agrees with the Go implementation on public-ness", () => {
          expect(isPublicAddress(v.addr)).toBe(v.category === "global");
        });

        it("honours blockLocal the same way Go's Blocked does", () => {
          if (v.category === "metadata") {
            expect(blocked(v.addr, false)).toBe(true);
            expect(blocked(v.addr, true)).toBe(true);
          } else if (v.category === "special") {
            expect(blocked(v.addr, false)).toBe(false);
            expect(blocked(v.addr, true)).toBe(true);
          } else {
            expect(blocked(v.addr, false)).toBe(false);
            expect(blocked(v.addr, true)).toBe(false);
          }
        });
      });
    }
  });
});

describe("when the address is unparseable", () => {
  it("fails closed as special, never global", () => {
    for (const bad of ["", "not-an-ip", "999.1.1.1", "10.0.0", "::ffff:zz"]) {
      expect(classify(bad)).toBe("special");
      expect(isPublicAddress(bad)).toBe(false);
    }
  });
});
