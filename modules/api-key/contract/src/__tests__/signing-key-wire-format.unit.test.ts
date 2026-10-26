/**
 * Braid wire format v1 as the contract reads it: the SDK's pinned vector
 * (ADR-185 section 4, signed calls) and what v1 never writes.
 */
import { describe, expect, it } from "vitest";

import { braidSignatureMessage, parseBraidSignature } from "../signing-key.wire-format.ts";

const PINNED_SIGNATURE =
  "eyJ2IjoxLCJraWQiOiJ0ZXN0a2lkIiwia2V5cyI6WyJvcmNoZXN0cmF0b3IiLCJ0ZWFtIl0sInNpZyI6IjFNWGtzUVIzc25vdVBZV0Z4TzVDZnlyRzY2WUQ1MzlhbmNlbWVRaG9VazQifQ";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Base64url without padding, by hand: the contract compiles without DOM or Node globals. */
function base64UrlOf(bytes: readonly number[]): string {
  let text = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk =
      ((bytes[index] ?? 0) << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    const sextets = Math.min(3, bytes.length - index) + 1;
    for (let sextet = 0; sextet < sextets; sextet += 1) {
      text += ALPHABET[(chunk >> (18 - 6 * sextet)) & 63];
    }
  }
  return text;
}

const asciiBytes = (text: string): number[] =>
  Array.from({ length: text.length }, (_, index) => text.charCodeAt(index));

function encoded(envelope: unknown): string {
  return base64UrlOf(asciiBytes(JSON.stringify(envelope)));
}

/** A valid envelope with one extra member whose name is the raw `nameBytes`. */
function withExtraMember(nameBytes: readonly number[]): string {
  const fields = '{"v":1,"kid":"testkid","keys":["orchestrator","team"],"sig":"x","';
  return base64UrlOf([...asciiBytes(fields), ...nameBytes, ...asciiBytes('":1}')]);
}

describe("parseBraidSignature", () => {
  it("reads the SDK's pinned signature", () => {
    expect(parseBraidSignature({ attribute: PINNED_SIGNATURE })).toEqual({
      v: 1,
      kid: "testkid",
      keys: ["orchestrator", "team"],
      sig: "1MXksQR3snouPYWFxO5CfyrG66YD539ancemeQhoUk4",
    });
  });

  it.each([
    ["text that is not base64url", "not base64!"],
    ["base64url that is not JSON", "bm90IGpzb24"],
    ["another version", encoded({ v: 2, kid: "k", keys: ["a"], sig: "x" })],
    ["a public id with an underscore", encoded({ v: 1, kid: "a_b", keys: ["a"], sig: "x" })],
    ["no keys", encoded({ v: 1, kid: "k", keys: [], sig: "x" })],
    ["keys out of order", encoded({ v: 1, kid: "k", keys: ["b", "a"], sig: "x" })],
    ["a repeated key", encoded({ v: 1, kid: "k", keys: ["a", "a"], sig: "x" })],
    [
      "the signature's own key",
      encoded({ v: 1, kid: "k", keys: ["langwatch.signature"], sig: "x" }),
    ],
    ["a key outside the pattern", encoded({ v: 1, kid: "k", keys: ["a b"], sig: "x" })],
  ])("refuses %s", (_case, attribute) => {
    expect(parseBraidSignature({ attribute })).toBeUndefined();
  });
});

describe("parseBraidSignature over UTF-8", () => {
  it("reads two-, three- and four-byte characters", () => {
    const attribute = withExtraMember([0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80]);

    expect(parseBraidSignature({ attribute })).toMatchObject({ kid: "testkid" });
  });

  it.each([
    ["a byte no sequence starts with", [0xff]],
    ["a truncated sequence", [0xc3]],
    ["an overlong sequence", [0xe0, 0x80, 0xaf]],
    ["a surrogate", [0xed, 0xa0, 0x80]],
    ["a code point past U+10FFFF", [0xf4, 0x90, 0x80, 0x80]],
  ])("refuses %s", (_case, nameBytes) => {
    expect(parseBraidSignature({ attribute: withExtraMember(nameBytes) })).toBeUndefined();
  });
});

describe("braidSignatureMessage", () => {
  it("joins the domain, the lower-case trace id and the sorted entries by line", () => {
    expect(
      braidSignatureMessage({
        traceId: "0AF7651916CD43DD8448EB211C80319C",
        entries: { team: "a", orchestrator: "web" },
      }),
    ).toEqual({
      kind: "message",
      text: [
        "langwatch-braid-signature-v1",
        "0af7651916cd43dd8448eb211c80319c",
        "orchestrator=web",
        "team=a",
      ].join("\n"),
    });
  });

  it.each([
    ["a value holding a line feed", { team: "a\norchestrator=web" }],
    ["a value holding a carriage return", { team: "a\r" }],
    ["a key outside the pattern", { "team name": "a" }],
    ["no entries", {}],
  ])("refuses %s", (_case, entries) => {
    expect(braidSignatureMessage({ traceId: "0af7", entries })).toEqual({ kind: "malformed" });
  });
});
