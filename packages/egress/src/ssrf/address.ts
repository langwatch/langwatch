/**
 * Canonical SSRF address-classification rules (shared with Go pkg/ssrf).
 * See dev/docs/adr/###-ssrf-rules for the rationale and the two-language contract.
 */

/**
 * How an egress boundary treats an address: `global` (public, safe to
 * dial), `metadata` (cloud instance-metadata, ALWAYS refused), `special`
 * (any other non-routable range; refused unless local/private egress is allowed).
 */
export type Category = "global" | "metadata" | "special";

// ---------------------------------------------------------------------------
// Address parsing (string → bytes). Node has no IP-to-bytes primitive, so we
// parse to a 4- or 16-byte array ourselves and mask-compare against prefixes.
// ---------------------------------------------------------------------------

/**
 * Parse a dotted-quad IPv4 literal to 4 network-order bytes, or null when it is
 * not one. Deliberately strict: no octal, hex, or shorthand forms, since those
 * alternate spellings of a private address are a standard filter bypass.
 */
function ipv4ToBytes(input: string): Uint8Array | null {
  const parts = input.split(".");
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    if (!/^\d{1,3}$/.test(parts[i]!)) return null;
    const n = Number(parts[i]);
    if (n > 255) return null;
    bytes[i] = n;
  }
  return bytes;
}

function parseIpv6Groups(part: string): number[] | null {
  if (part === "") return [];
  const out: number[] = [];
  for (const group of part.split(":")) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    out.push(parseInt(group, 16));
  }
  return out;
}

function expandIpv6Groups(halves: string[]): number[] | null {
  const head = parseIpv6Groups(halves[0]!);
  if (head === null) return null;

  if (halves.length !== 2) return head;

  const tail = parseIpv6Groups(halves[1]!);
  if (tail === null) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  return [...head, ...Array.from({ length: missing }, () => 0), ...tail];
}

/**
 * Parse an IPv6 literal to 16 network-order bytes, or null when it is not one.
 * Handles `::` elision and a trailing embedded IPv4 (`::ffff:1.2.3.4`), both of
 * which have to resolve here so the mapped form cannot dodge classification.
 */
function ipv6ToBytes(input: string): Uint8Array | null {
  let s = input;
  const zone = s.indexOf("%"); // strip scope/zone id (fe80::1%eth0)
  if (zone !== -1) s = s.slice(0, zone);

  // Embedded IPv4 tail (e.g. ::ffff:1.2.3.4): rewrite the dotted quad as two
  // hextets so the rest of the parser only sees hex groups.
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    if (lastColon === -1) return null;
    const v4 = ipv4ToBytes(s.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0]! << 8) | v4[1]!).toString(16);
    const lo = ((v4[2]! << 8) | v4[3]!).toString(16);
    s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null; // more than one "::" is invalid

  const groups = expandIpv6Groups(halves);
  if (groups === null) return null;
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    bytes[i * 2] = (groups[i]! >> 8) & 0xff;
    bytes[i * 2 + 1] = groups[i]! & 0xff;
  }
  return bytes;
}

/** Parse an IPv4 or IPv6 literal to its network-order bytes, or null. */
function ipToBytes(ip: string): Uint8Array | null {
  return ip.includes(":") ? ipv6ToBytes(ip) : ipv4ToBytes(ip);
}

/**
 * Collapse an IPv4-mapped IPv6 address (::ffff:a.b.c.d) to its 4-byte IPv4 form
 * so it classifies as the IPv4 address it really is — the mapped form is a
 * classic filter bypass. Mirrors Go's netip.Addr.Unmap().
 */
function unmap(bytes: Uint8Array): Uint8Array {
  if (bytes.length !== 16) return bytes;
  for (let i = 0; i < 10; i++) {
    if (bytes[i] !== 0) return bytes;
  }
  if (bytes[10] === 0xff && bytes[11] === 0xff) return bytes.slice(12, 16);
  return bytes;
}

// ---------------------------------------------------------------------------
// Prefix matching.
// ---------------------------------------------------------------------------

/**
 * A CIDR block in compared form: the network bytes, the significant bit count,
 * and the RFC that reserves it. `rfc` is carried so a refusal can tell an
 * operator *which* registry entry matched rather than just "blocked".
 */
interface Prefix {
  bytes: Uint8Array;
  bits: number;
  rfc: string;
}

/**
 * Parse a `"10.0.0.0/8"`-style literal into a {@link Prefix}. Throws rather than
 * returning null: these are module-level constants, so a malformed entry is a
 * programming error that must fail at import, never a silently absent rule.
 */
function parsePrefix({ cidr, rfc }: { cidr: string; rfc: string }): Prefix {
  const slash = cidr.lastIndexOf("/");
  const bytes = ipToBytes(cidr.slice(0, slash));
  if (!bytes) throw new Error(`ssrf: bad prefix ${cidr}`);
  return { bytes, bits: Number(cidr.slice(slash + 1)), rfc };
}

/** Whether addr (already unmapped) falls inside prefix. */
function prefixContains({ prefix, addr }: { prefix: Prefix; addr: Uint8Array }): boolean {
  if (prefix.bytes.length !== addr.length) return false; // different family
  let bits = prefix.bits;
  let i = 0;
  while (bits >= 8) {
    if (prefix.bytes[i] !== addr[i]) return false;
    i++;
    bits -= 8;
  }
  if (bits > 0) {
    const mask = (0xff << (8 - bits)) & 0xff;
    if ((prefix.bytes[i]! & mask) !== (addr[i]! & mask)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The canonical rule set.
// ---------------------------------------------------------------------------

/**
 * Cloud instance-metadata endpoints — never legitimate, refused regardless
 * of private-egress permission. 168.63.129.16 (Azure WireServer) is why this
 * list matters: it looks globally-routable, in no special range at all.
 */
const METADATA_ADDRESSES = [
  "169.254.169.254", // AWS/GCP/Azure/Oracle IMDS
  "169.254.170.2", // AWS ECS/Fargate task metadata
  "168.63.129.16", // Azure WireServer / host DNS
  "fd00:ec2::254", // AWS EC2 IMDS over IPv6
].map((ip) => {
  const bytes = unmap(ipToBytes(ip)!);
  return bytes;
});

/**
 * Non-globally-routable ranges, expressed as prefixes (not host predicates)
 * so the whole rule set reads as one table. NAT64 and 6to4 are refused
 * wholesale, not decoded to their embedded IPv4 — no legitimate target is translated.
 */
const SPECIAL_PREFIXES: Prefix[] = [
  // IPv4
  parsePrefix({ cidr: "0.0.0.0/8", rfc: "RFC1122 this network / unspecified" }),
  parsePrefix({ cidr: "10.0.0.0/8", rfc: "RFC1918 private" }),
  parsePrefix({
    cidr: "100.64.0.0/10",
    rfc: "RFC6598 CGNAT / shared address space",
  }),
  parsePrefix({ cidr: "127.0.0.0/8", rfc: "RFC1122 loopback" }),
  parsePrefix({ cidr: "169.254.0.0/16", rfc: "RFC3927 link-local" }),
  parsePrefix({ cidr: "172.16.0.0/12", rfc: "RFC1918 private" }),
  parsePrefix({
    cidr: "192.0.0.0/24",
    rfc: "RFC6890 IETF protocol assignments",
  }),
  parsePrefix({
    cidr: "192.0.2.0/24",
    rfc: "RFC5737 TEST-NET-1 documentation",
  }),
  parsePrefix({
    cidr: "192.88.99.0/24",
    rfc: "RFC7526 6to4 relay anycast, deprecated",
  }),
  parsePrefix({ cidr: "192.168.0.0/16", rfc: "RFC1918 private" }),
  parsePrefix({ cidr: "198.18.0.0/15", rfc: "RFC2544 benchmarking" }),
  parsePrefix({
    cidr: "198.51.100.0/24",
    rfc: "RFC5737 TEST-NET-2 documentation",
  }),
  parsePrefix({
    cidr: "203.0.113.0/24",
    rfc: "RFC5737 TEST-NET-3 documentation",
  }),
  parsePrefix({ cidr: "224.0.0.0/4", rfc: "RFC5771 multicast" }),
  parsePrefix({
    cidr: "240.0.0.0/4",
    rfc: "RFC1112 reserved incl. 255.255.255.255 broadcast",
  }),
  // IPv6
  parsePrefix({ cidr: "::/128", rfc: "RFC4291 unspecified" }),
  parsePrefix({ cidr: "::1/128", rfc: "RFC4291 loopback" }),
  parsePrefix({ cidr: "64:ff9b::/96", rfc: "RFC6052 well-known NAT64" }),
  parsePrefix({ cidr: "64:ff9b:1::/48", rfc: "RFC8215 local-use NAT64" }),
  parsePrefix({ cidr: "100::/64", rfc: "RFC6666 discard-only" }),
  parsePrefix({ cidr: "2001::/32", rfc: "RFC4380 Teredo" }),
  parsePrefix({ cidr: "2001:db8::/32", rfc: "RFC3849 documentation" }),
  parsePrefix({ cidr: "2002::/16", rfc: "RFC3056 6to4" }),
  parsePrefix({ cidr: "3fff::/20", rfc: "RFC9637 documentation" }),
  parsePrefix({ cidr: "fc00::/7", rfc: "RFC4193 unique-local" }),
  parsePrefix({ cidr: "fe80::/10", rfc: "RFC4291 link-local unicast" }),
  parsePrefix({ cidr: "ff00::/8", rfc: "RFC4291 multicast" }),
];

/** Whether two addresses are byte-for-byte identical. */
function bytesEqual({ a, b }: { a: Uint8Array; b: Uint8Array }): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Classify an IP literal. An unparseable address is treated as `special` so a
 * parse failure fails closed rather than slipping through as "not obviously
 * private". Mirrors Go's ssrf.Classify.
 */
function isMetadataAddress(addr: Uint8Array): boolean {
  return METADATA_ADDRESSES.some((m) => bytesEqual({ a: m, b: addr }));
}

export function classify(ip: string): Category {
  const raw = ipToBytes(ip);
  if (!raw) return "special";
  const addr = unmap(raw);

  if (isMetadataAddress(addr)) return "metadata";
  for (const prefix of SPECIAL_PREFIXES) {
    if (prefixContains({ prefix, addr })) return "special";
  }
  return "global";
}

/**
 * Whether ip is globally routable — the only class a strict egress boundary may
 * dial. Use where every non-public address must be refused. Mirrors Go's
 * ssrf.IsPublicAddress.
 */
export function isPublicAddress(ip: string): boolean {
  return classify(ip) === "global";
}

/**
 * Whether ip must be refused given whether local/private egress is permitted.
 * Metadata is always refused; other special ranges are refused only when
 * blockLocal is set. Mirrors Go's ssrf.Blocked.
 */
export function blocked({ ip, blockLocal }: { ip: string; blockLocal: boolean }): boolean {
  switch (classify(ip)) {
    case "metadata":
      return true;
    case "special":
      return blockLocal;
    default:
      return false;
  }
}
