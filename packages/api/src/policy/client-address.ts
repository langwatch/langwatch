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
  const set = new BlockList();
  let declared = 0;

  for (const entry of entries) {
    const [network = "", prefix] = entry.trim().split("/");
    const address = parseAddress(network);
    if (address === null) continue;

    const family = isIP(address) === 6 ? "ipv6" : "ipv4";
    if (prefix === void 0) {
      set.addAddress(address, family);
      declared++;
      continue;
    }

    // An IPv4-mapped range (`::ffff:10.0.0.0/104`) is unmapped with its address, so its prefix
    // drops the 96 bits of the mapping too.
    const mapped = family === "ipv4" && isIP(network.trim()) === 6;
    const bits = Number(prefix) - (mapped ? 96 : 0);
    const widest = family === "ipv6" ? 128 : 32;
    if (!Number.isInteger(bits) || bits < 0 || bits > widest) continue;

    set.addSubnet(address, bits, family);
    declared++;
  }

  return declared === 0 ? void 0 : set;
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
