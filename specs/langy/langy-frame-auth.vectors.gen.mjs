// Independent reference generator for langy-frame-auth.vectors.json.
//
// This is deliberately a raw node:crypto implementation of the signing
// construction — NOT an import of the TS relay verifier or the Go signer — so
// the checked-in vectors are an oracle neither implementation authored. A
// passing TS + Go suite therefore proves Go ≡ TS ≡ oracle.
//
// Regenerate:  node specs/langy/langy-frame-auth.vectors.gen.mjs > /tmp/v.json
// then reconcile the `mac` fields into langy-frame-auth.vectors.json.
//
// Construction (see langy-frame-auth.vectors.json "construction"):
//   signingInput = concat over [projectId, userId, conversationId, turnId,
//                  frameNonce, payload] of uint32BE(utf8ByteLen(field)) ‖ utf8(field)
//   mac = hex( HMAC-SHA256( key = hexDecode(runToken), signingInput ) )
import { createHmac } from "node:crypto";

const FIELDS = ["projectId", "userId", "conversationId", "turnId", "frameNonce", "payload"];

function signingInput(f) {
  const chunks = [];
  for (const name of FIELDS) {
    const b = Buffer.from(f[name], "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(b.length, 0);
    chunks.push(len, b);
  }
  return Buffer.concat(chunks);
}

export function computeMac(runTokenHex, f) {
  const key = Buffer.from(runTokenHex, "hex");
  return createHmac("sha256", key).update(signingInput(f)).digest("hex");
}

const runToken =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

const vectors = [
  { name: "delta-frame", runToken, projectId: "proj_test", userId: "user_test", conversationId: "conv_test", turnId: "turn_test", frameNonce: "0123456789abcdef0123456789abcdef", payload: JSON.stringify({ type: "delta", text: "hello" }) },
  { name: "heartbeat-minimal", runToken, projectId: "p", userId: "u", conversationId: "c", turnId: "t", frameNonce: "ffffffffffffffffffffffffffffffff", payload: JSON.stringify({ type: "heartbeat" }) },
  { name: "unicode-card-payload", runToken, projectId: "prj_ünîcode", userId: "usr_🔒", conversationId: "conv-1", turnId: "turn-9", frameNonce: "abad1deaabad1deaabad1deaabad1dea", payload: JSON.stringify({ type: "card", kind: "trace_download", detail: "café ☕" }) },
];
for (const v of vectors) v.mac = computeMac(runToken, v);

const empty = { conversationId: "", turnId: "", frameNonce: "", payload: "" };
const a = { ...empty, projectId: "ab", userId: "c" };
const b = { ...empty, projectId: "a", userId: "bc" };

console.log(
  JSON.stringify(
    {
      vectors,
      fieldShift: {
        runToken,
        a: { ...a, mac: computeMac(runToken, a) },
        b: { ...b, mac: computeMac(runToken, b) },
      },
    },
    null,
    2,
  ),
);
