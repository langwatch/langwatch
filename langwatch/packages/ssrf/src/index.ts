/**
 * @langwatch/ssrf — canonical SSRF address-classification rules.
 *
 * This is the TypeScript half of a two-language contract. The Go half lives in
 * `pkg/ssrf` (package ssrf); both are held to the identical behaviour by the
 * shared conformance corpus in `pkg/ssrf/testdata/address_vectors.json`. Before
 * this package the same "is this IP safe to egress to?" decision was
 * re-implemented independently in the AI gateway, the Langy egress proxy, this
 * app's utils/ssrfProtection.ts and the Python NLP service — and they drifted.
 * A tenant who controls DNS can steer a request into whichever gap a given
 * service left open, so the rule set must be one thing, expressed once.
 *
 * The prefix set is the union of the two IANA Special-Purpose Address
 * Registries. Every entry is named with its RFC at the point of declaration.
 *   - IPv4: https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml
 *   - IPv6: https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml
 *   - AWS EKS "Restrict host networking and block access to the instance
 *     metadata service" (block egress to 169.254.0.0/16; IMDSv2 hop limit 1):
 *     https://docs.aws.amazon.com/whitepapers/latest/security-practices-multi-tenant-saas-applications-eks/restrict-the-use-of-host-networking-and-block-access-to-instance-metadata-service.html
 *
 * @module @langwatch/ssrf
 */

/**
 * How an egress boundary must treat an address.
 * - `global`   — routable public address; the only class safe to dial.
 * - `metadata` — cloud instance-metadata endpoint; ALWAYS refused.
 * - `special`  — any other non-routable address (loopback, RFC1918, CGNAT,
 *   benchmarking, documentation, reserved, NAT64, 6to4, …); refused when
 *   local/private egress is disallowed (always on hosted SaaS).
 */
export type Category = "global" | "metadata" | "special";

// ---------------------------------------------------------------------------
// Address parsing (string → bytes). Node has no IP-to-bytes primitive, so we
// parse to a 4- or 16-byte array ourselves and mask-compare against prefixes.
// ---------------------------------------------------------------------------

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

  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const head = parseGroups(halves[0]!);
  if (head === null) return null;

  let groups: number[];
  if (halves.length === 2) {
    const tail = parseGroups(halves[1]!);
    if (tail === null) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...new Array<number>(missing).fill(0), ...tail];
  } else {
    groups = head;
  }
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

interface Prefix {
  bytes: Uint8Array;
  bits: number;
  rfc: string;
}

function parsePrefix(cidr: string, rfc: string): Prefix {
  const slash = cidr.lastIndexOf("/");
  const bytes = ipToBytes(cidr.slice(0, slash));
  if (!bytes) throw new Error(`@langwatch/ssrf: bad prefix ${cidr}`);
  return { bytes, bits: Number(cidr.slice(slash + 1)), rfc };
}

/** Whether addr (already unmapped) falls inside prefix. */
function prefixContains(prefix: Prefix, addr: Uint8Array): boolean {
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
 * Cloud instance-metadata endpoints — never a legitimate egress destination,
 * refused regardless of whether private egress is otherwise permitted.
 * 168.63.129.16 (Azure WireServer) is why this list is load-bearing: it is a
 * globally-routable-looking address in no special range at all.
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
 * Non-globally-routable ranges. Loopback / RFC1918 / link-local / multicast are
 * expressed as prefixes here (rather than relying on host predicates) so the
 * whole rule set reads as one table. NAT64 and 6to4 are refused wholesale
 * rather than decoded to their embedded IPv4 — no legitimate egress targets a
 * translated address.
 */
const SPECIAL_PREFIXES: Prefix[] = [
  // IPv4
  parsePrefix("0.0.0.0/8", "RFC1122 this network / unspecified"),
  parsePrefix("10.0.0.0/8", "RFC1918 private"),
  parsePrefix("100.64.0.0/10", "RFC6598 CGNAT / shared address space"),
  parsePrefix("127.0.0.0/8", "RFC1122 loopback"),
  parsePrefix("169.254.0.0/16", "RFC3927 link-local"),
  parsePrefix("172.16.0.0/12", "RFC1918 private"),
  parsePrefix("192.0.0.0/24", "RFC6890 IETF protocol assignments"),
  parsePrefix("192.0.2.0/24", "RFC5737 TEST-NET-1 documentation"),
  parsePrefix("192.88.99.0/24", "RFC7526 6to4 relay anycast, deprecated"),
  parsePrefix("192.168.0.0/16", "RFC1918 private"),
  parsePrefix("198.18.0.0/15", "RFC2544 benchmarking"),
  parsePrefix("198.51.100.0/24", "RFC5737 TEST-NET-2 documentation"),
  parsePrefix("203.0.113.0/24", "RFC5737 TEST-NET-3 documentation"),
  parsePrefix("224.0.0.0/4", "RFC5771 multicast"),
  parsePrefix("240.0.0.0/4", "RFC1112 reserved incl. 255.255.255.255 broadcast"),
  // IPv6
  parsePrefix("::/128", "RFC4291 unspecified"),
  parsePrefix("::1/128", "RFC4291 loopback"),
  parsePrefix("64:ff9b::/96", "RFC6052 well-known NAT64"),
  parsePrefix("64:ff9b:1::/48", "RFC8215 local-use NAT64"),
  parsePrefix("100::/64", "RFC6666 discard-only"),
  parsePrefix("2001::/32", "RFC4380 Teredo"),
  parsePrefix("2001:db8::/32", "RFC3849 documentation"),
  parsePrefix("2002::/16", "RFC3056 6to4"),
  parsePrefix("3fff::/20", "RFC9637 documentation"),
  parsePrefix("fc00::/7", "RFC4193 unique-local"),
  parsePrefix("fe80::/10", "RFC4291 link-local unicast"),
  parsePrefix("ff00::/8", "RFC4291 multicast"),
];

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
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
export function classify(ip: string): Category {
  const raw = ipToBytes(ip);
  if (!raw) return "special";
  const addr = unmap(raw);

  if (METADATA_ADDRESSES.some((m) => bytesEqual(m, addr))) return "metadata";
  for (const prefix of SPECIAL_PREFIXES) {
    if (prefixContains(prefix, addr)) return "special";
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
export function blocked(ip: string, blockLocal: boolean): boolean {
  switch (classify(ip)) {
    case "metadata":
      return true;
    case "special":
      return blockLocal;
    default:
      return false;
  }
}
