/**
 * Which address a request came from, resolved ONCE at the door. A header is read only from a
 * socket peer inside TRUSTED_PROXY_ADDRESSES, never because the peer is private.
 * Spec: specs/security/trusted-client-address.feature
 */
import type { IncomingMessage } from "node:http";
import { BlockList, isIP } from "node:net";

/** The parts of a request this answer is read from, whatever framework carries it. */
export type AddressedRequest = Readonly<{
  /** One header's value, joined where the transport presents a list. */
  header: (name: string) => string | undefined;
  /** The raw peer, before any header is considered. */
  socketAddress?: string | undefined;
}>;

/** The chain every proxy appends the address it received the request from to. */
const FORWARDED_FOR_HEADER = "x-forwarded-for";

/** Written by Cloudflare, and by anyone reaching the origin directly: read only when trusted. */
const CLOUDFLARE_ADDRESS_HEADER = "cf-connecting-ip";

export class ClientAddress {
  /**
   * The hops this deployment trusts, as IPv4/IPv6 addresses or CIDR ranges; absent or empty, no
   * header is read. `trustCloudflare` honours CF-Connecting-IP, still only from a trusted peer.
   */
  static fromTrustedProxies(config: {
    addresses?: readonly string[] | undefined;
    trustCloudflare?: boolean | undefined;
  }): ClientAddress {
    return new ClientAddress(trustedSet(config.addresses ?? []), config.trustCloudflare === true);
  }

  /**
   * The address already resolved for this request. Read rather than derived a
   * second time, which is what keeps two counters over one caller from
   * disagreeing about who that caller is.
   */
  static resolvedFor(request: Request | IncomingMessage): string | undefined {
    return (request as { [RESOLVED]?: string })[RESOLVED];
  }

  /** A request rebuilt from another (a buffered body, a rewritten path) keeps its caller. */
  static carried({ from, to }: { from: Request; to: Request }): Request {
    stamp(to, ClientAddress.resolvedFor(from));
    return to;
  }

  private constructor(
    private readonly trusted: BlockList | undefined,
    private readonly trustCloudflare: boolean,
  ) {}

  /**
   * As the mux's middleware: resolved ONCE, before routing, and left on the
   * request for everything behind it. The answer's headers are untouched — this
   * decides who called, never what they are told.
   */
  handle(exchange: { request: Request; socketAddress: string | undefined }): void {
    stamp(
      exchange.request,
      this.of({
        header: (name) => exchange.request.headers.get(name) ?? void 0,
        ...(exchange.socketAddress ? { socketAddress: exchange.socketAddress } : {}),
      }),
    );
  }

  /** The same answer for a raw Node request, which a raw door reads ahead of the mux. */
  handleIncoming(request: IncomingMessage): void {
    stamp(
      request,
      this.of({
        header: (name) => {
          const value = request.headers[name];
          return Array.isArray(value) ? value.join(",") : value;
        },
        ...(request.socket?.remoteAddress ? { socketAddress: request.socket.remoteAddress } : {}),
      }),
    );
  }

  /**
   * The socket, unless the peer is a declared hop; from one, the address Cloudflare names when
   * trusted, else the rightmost forwarded-for hop no trusted proxy wrote.
   */
  of(request: AddressedRequest): string | undefined {
    const socket = request.socketAddress ? (parseAddress(request.socketAddress) ?? void 0) : void 0;
    if (socket === void 0 || !this.isTrustedHop(socket)) return socket;

    const cloudflare = this.trustCloudflare ? cloudflareAddress(request) : void 0;
    if (cloudflare !== void 0) return cloudflare;

    return this.forwardedAddress(request) ?? socket;
  }

  private isTrustedHop(address: string): boolean {
    if (!this.trusted) return false;

    return this.trusted.check(address, isIP(address) === 6 ? "ipv6" : "ipv4");
  }

  private forwardedAddress(request: AddressedRequest): string | undefined {
    const hops = (request.header(FORWARDED_FOR_HEADER) ?? "").split(",");

    for (let index = hops.length - 1; index >= 0; index--) {
      const hop = (hops[index] ?? "").trim();
      if (hop === "") continue;

      // A hop no parser reads (ip:port, say) may be the one a proxy wrote: stop, so an earlier
      // hop the client wrote itself is never believed in its place.
      const address = parseAddress(hop);
      if (address === null) return void 0;

      if (!this.isTrustedHop(address)) return address;
    }

    return void 0;
  }
}

/** Where the one resolved address is left for everything behind the door. */
const RESOLVED = Symbol.for("langwatch.api.clientAddress");

function stamp(request: object, address: string | undefined): void {
  if (address === void 0) return;

  Object.defineProperty(request, RESOLVED, { value: address, configurable: true });
}

/**
 * The declared hops as one membership test; an entry that is neither an
 * address nor a range matches nothing. Empty means no hop is trusted.
 */
function trustedSet(entries: readonly string[]): BlockList | undefined {
  const ranges = entries.flatMap((entry) => trustedHopRange(entry) ?? []);
  if (ranges.length === 0) return void 0;

  const set = new BlockList();
  for (const { address, bits, family } of ranges) set.addSubnet(address, bits, family);
  return set;
}

export type TrustedHopRange = Readonly<{ address: string; bits: number; family: "ipv4" | "ipv6" }>;

/**
 * One TRUSTED_PROXY_ADDRESSES entry as the range it trusts, or nothing when it names none: not an
 * address or CIDR range, or an IPv6 range reaching past the IPv4-mapped block, which would trust
 * every IPv4 peer. An IPv4-mapped range (`::ffff:10.0.0.0/104`) is read as its IPv4 range.
 */
export function trustedHopRange(entry: string): TrustedHopRange | undefined {
  const [network = "", prefix, extra] = entry.trim().split("/");
  const address = parseAddress(network);
  if (address === null || extra !== void 0) return void 0;

  const family = isIP(address) === 6 ? "ipv6" : "ipv4";
  const widest = family === "ipv6" ? 128 : 32;
  if (prefix === void 0) return { address, bits: widest, family };
  if (!/^\d+$/.test(prefix)) return void 0;

  const mapped = family === "ipv4" && isIP(network.trim()) === 6;
  const bits = Number(prefix) - (mapped ? MAPPED_PREFIX_BITS : 0);
  if (bits < 0 || bits > widest) return void 0;
  if (family === "ipv6" && bits < MAPPED_PREFIX_BITS && coversMappedBlock(address, bits)) {
    return void 0;
  }

  return { address, bits, family };
}

/** `::ffff:` and the 32 bits of an IPv4 address: the IPv4 range's prefix plus 96. */
const MAPPED_PREFIX_BITS = 96;

/** The IPv4-mapped block's 96-bit prefix, as six 16-bit groups: `::ffff:0:0`. */
const MAPPED_GROUPS = [0, 0, 0, 0, 0, 0xffff] as const;

/** Whether the range `network/bits` contains the IPv4-mapped block, in any notation. */
function coversMappedBlock(network: string, bits: number): boolean {
  const groups = ipv6Groups(network);

  return MAPPED_GROUPS.every((mapped, index) => {
    const masked = Math.max(0, Math.min(16, bits - index * 16));
    const mask = masked === 0 ? 0 : (0xffff << (16 - masked)) & 0xffff;
    return ((groups[index] ?? 0) & mask) === (mapped & mask);
  });
}

/** An IPv6 address `isIP` accepted, as its eight 16-bit groups; a dotted IPv4 tail is two. */
function ipv6Groups(address: string): number[] {
  const [head = "", tail] = address.toLowerCase().split("::");
  const leading = groupsOf(head);
  if (tail === void 0) return leading;
  const trailing = groupsOf(tail);

  return [...leading, ...Array<number>(8 - leading.length - trailing.length).fill(0), ...trailing];
}

function groupsOf(part: string): number[] {
  if (part === "") return [];

  return part.split(":").flatMap((group) => {
    if (isIP(group) !== 4) return [parseInt(group, 16)];
    const [a = 0, b = 0, c = 0, d = 0] = group.split(".").map(Number);
    return [(a << 8) | b, (c << 8) | d];
  });
}

/** The one address Cloudflare names; anything else in the header (a list, a word) is ignored. */
function cloudflareAddress(request: AddressedRequest): string | undefined {
  const value = request.header(CLOUDFLARE_ADDRESS_HEADER);
  if (!value || value.includes(",")) return void 0;

  return parseAddress(value) ?? void 0;
}

/** One address, or nothing when the text is not one. An IPv4-mapped IPv6 address is its IPv4. */
function parseAddress(value: string): string | null {
  const trimmed = value.trim();
  const unmapped = trimmed.replace(/^::ffff:/i, "");
  const address = isIP(unmapped) === 4 ? unmapped : trimmed;

  return isIP(address) === 0 ? null : address.toLowerCase();
}
