/**
 * Which address a request actually came from, behind this deployment's own
 * hops. Resolved ONCE at the door for every request: a per-IP limit on the
 * tRPC side and one on a REST route must not disagree about who is calling.
 */
import { isIP } from "node:net";

/** The parts of a request this answer is read from, whatever framework carries it. */
export type AddressedRequest = Readonly<{
  /** One header's value, joined where the transport presents a list. */
  header: (name: string) => string | undefined;
  /** The raw peer, before any header is considered. */
  socketAddress?: string | undefined;
}>;

/** In order of preference; the first that yields an untrusted hop wins. */
const ADDRESS_HEADERS = [
  "cf-connecting-ip", // Cloudflare
  "x-forwarded-for", // AWS ELB and general proxy
  "x-forwarded", // AWS ELB
  "x-real-ip", // Nginx proxy
  "x-client-ip", // Apache
  "forwarded-for", // General forwarded header
  "forwarded", // General forwarded header
  "true-client-ip", // Akamai and Cloudflare
  "x-cluster-client-ip", // Rackspace LB, Riverbed Stingray
  "fastly-client-ip", // Fastly CDN
] as const;

/**
 * Ranges unreachable from the public internet, so an address in one belongs to
 * the operator's own network. Carrier-grade NAT (100.64.0.0/10) is deliberately
 * absent: mobile carriers put subscribers there, so it is a caller, not a hop.
 */
const PRIVATE_IPV4_RANGES = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "127.0.0.0/8",
  "169.254.0.0/16",
] as const;

/** What this class reports to, so it depends on no logging implementation. */
export type ClientAddressReporter = Readonly<{
  warn: (context: object, message: string) => void;
}>;

export class ClientAddress {
  /**
   * The hops this deployment trusts. Three-valued on purpose: an absent list
   * classifies the peer by address, an EMPTY list means "trust nothing", and a
   * populated one is the operator's exact answer.
   */
  static fromTrustedProxies(config: { addresses?: readonly string[] | undefined }): ClientAddress {
    return new ClientAddress(config.addresses);
  }

  /** No list at all: a private peer counts as infrastructure, a public one does not. */
  static classifyByAddress(): ClientAddress {
    return new ClientAddress(void 0);
  }

  /**
   * The address already resolved for this request. Read rather than derived a
   * second time, which is what keeps two counters over one caller from
   * disagreeing about who that caller is.
   */
  static resolvedFor(request: Request): string | undefined {
    return (request as { [RESOLVED]?: string })[RESOLVED];
  }

  /**
   * Said once, not once per request: this is a deployment fact, and repeating
   * it on a hot path would bury the thing it is trying to point at.
   */
  #announced = false;

  private constructor(private readonly trusted: readonly string[] | undefined) {}

  /**
   * As the mux's middleware: resolved ONCE, before routing, and left on the
   * request for everything behind it. The answer's headers are untouched — this
   * decides who called, never what they are told.
   */
  handle(exchange: { request: Request; socketAddress: string | undefined }): void {
    const address = this.of({
      header: (name) => exchange.request.headers.get(name) ?? void 0,
      ...(exchange.socketAddress ? { socketAddress: exchange.socketAddress } : {}),
    });

    if (address === void 0) return;

    Object.defineProperty(exchange.request, RESOLVED, { value: address, configurable: true });
  }

  /**
   * The caller's address: the socket, unless the request arrived from one of
   * this deployment's own hops, in which case the rightmost hop no trusted
   * proxy wrote.
   */
  of(request: AddressedRequest, reporter?: ClientAddressReporter): string | undefined {
    const socket = request.socketAddress ? (parseAddress(request.socketAddress) ?? void 0) : void 0;
    if (reporter) this.announceUndeclaredPublicProxyOnce(request, socket, reporter);

    if (socket === void 0 || !this.isInfrastructureHop(socket)) return socket;

    return this.forwardedAddress(request) ?? socket;
  }

  /**
   * Whether an address is this deployment's own hop rather than a caller. With a list present the
   * operator has answered exactly; absent, a private peer counts as infrastructure, which is what
   * keeps visitors behind one office router from sharing a single signed-out budget.
   */
  private isInfrastructureHop(address: string): boolean {
    if (this.trusted === void 0) return isPrivateAddress(address);

    return this.trusted.some((entry) =>
      entry.includes("/") ? withinIpv4Range(address, entry) : entry === address,
    );
  }

  private forwardedAddress(request: AddressedRequest): string | undefined {
    for (const name of ADDRESS_HEADERS) {
      const value = request.header(name);
      if (!value) continue;

      const hops = value.split(",");

      for (let index = hops.length - 1; index >= 0; index--) {
        const address = parseAddress(hops[index] ?? "");
        if (address === null) continue;

        if (!this.isInfrastructureHop(address)) return address;
      }
    }

    return void 0;
  }

  /**
   * A proxy on a public address nobody declared: a private hop is recognised,
   * but a public one is indistinguishable from a caller, so every visitor
   * behind it shares one signed-out budget. Only a declared list tells them apart.
   */
  private announceUndeclaredPublicProxyOnce(
    request: AddressedRequest,
    socket: string | undefined,
    reporter: ClientAddressReporter,
  ): void {
    if (this.#announced) return;

    if (this.trusted !== void 0 && this.trusted.length > 0) return;

    if (!request.header("x-forwarded-for")) return;

    if (socket === void 0 || isPrivateAddress(socket)) return;

    this.#announced = true;

    reporter.warn(
      { setting: "TRUSTED_PROXY_ADDRESSES" },
      "Ignored a forwarded-for header from a public peer, so signed-out authentication limits are counting that peer rather than the caller behind it. If it is this deployment's proxy, name it in TRUSTED_PROXY_ADDRESSES.",
    );
  }
}

/** Where the one resolved address is left for everything behind the mux. */
const RESOLVED = Symbol.for("langwatch.api.clientAddress");

/** One address, or nothing when the text is not one. */
function parseAddress(value: string): string | null {
  const address = value.replace(/^\s*::ffff:/, "").trim();

  return isIP(address) === 0 ? null : address;
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    return PRIVATE_IPV4_RANGES.some((range) => withinIpv4Range(address, range));
  }

  return isPrivateIpv6(address);
}

/** Loopback (`::1`), unique-local (`fc00::/7`) and link-local (`fe80::/10`). */
function isPrivateIpv6(address: string): boolean {
  if (isIP(address) !== 6) return false;

  const normalized = address.toLowerCase();
  if (normalized === "::1") return true;

  const firstGroup = normalized.split(":")[0];
  if (!firstGroup) return false;

  const group = Number.parseInt(firstGroup, 16);
  if (Number.isNaN(group)) return false;

  return (group & 0xfe_00) === 0xfc_00 || (group & 0xff_c0) === 0xfe_80;
}

/** IPv4 prefix membership; anything unparsable matches nothing. */
function withinIpv4Range(address: string, range: string): boolean {
  const [network, prefix] = range.split("/");
  const bits = Number(prefix);
  const hasValidPrefix = network !== void 0 && Number.isInteger(bits) && bits >= 0 && bits <= 32;
  if (!hasValidPrefix) return false;

  const target = ipv4AsNumber(address);
  const base = ipv4AsNumber(network);
  if (target === null || base === null) return false;

  const mask = bits === 0 ? 0 : (0xff_ff_ff_ff << (32 - bits)) >>> 0;

  return (target & mask) === (base & mask);
}

function ipv4AsNumber(address: string): number | null {
  if (isIP(address) !== 4) return null;

  const octets = address.split(".").map(Number);
  if (octets.some((octet) => octet > 255)) return null;

  return octets.reduce((total, octet) => ((total << 8) | octet) >>> 0, 0);
}
