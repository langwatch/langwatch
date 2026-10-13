import type { ContentSecurityPolicy } from "./content-security-policy.ts";

/** Immutable security policy; overlays leave the shared defaults intact. */
export class SecurityHeaders {
  /** HSTS is production-only so localhost remains reachable over plain HTTP. */
  static strict(options: { production?: boolean } = {}): SecurityHeaders {
    return new SecurityHeaders([
      ["X-Content-Type-Options", "nosniff"],
      ["X-Frame-Options", "DENY"],
      ["Referrer-Policy", "no-referrer"],
      ...(options.production === true
        ? ([["Strict-Transport-Security", "max-age=31536000; includeSubDomains"]] as const)
        : []),
    ]);
  }

  /** No headers at all. Only a test, or a policy built up from nothing, wants this. */
  static none(): SecurityHeaders {
    return new SecurityHeaders([]);
  }

  readonly #headers: ReadonlyMap<string, string>;

  private constructor(entries: Iterable<readonly [string, string]>) {
    const headers = new Map<string, string>();
    for (const [name, value] of entries) headers.set(name.toLowerCase(), value);

    this.#headers = headers;
  }

  /** One more header on top of this policy, as a new policy. */
  with(name: string, value: string): SecurityHeaders {
    return new SecurityHeaders([...this.#headers, [name, value]]);
  }

  /**
   * One header off this policy. Named `without` rather than an optional
   * argument to `with` so dropping part of the floor reads as the exception it
   * is at the call site.
   */
  without(name: string): SecurityHeaders {
    return new SecurityHeaders(
      [...this.#headers].filter(([header]) => header !== name.toLowerCase()),
    );
  }

  /** Both sets, the other winning where they name the same header. */
  merge(other: SecurityHeaders): SecurityHeaders {
    return new SecurityHeaders([...this.#headers, ...other.#headers]);
  }

  /**
   * The document policy, folded in as whichever header it is sent as. Stated
   * as ONE call rather than the caller reading `asHeader()` and merging, so
   * nothing has to know that a reporting policy travels under a second name.
   */
  withContentSecurityPolicy(policy: ContentSecurityPolicy): SecurityHeaders {
    const { name, value } = policy.asHeader();

    return this.with(name, value);
  }

  /** What a response carries, ready to spread into a header record. */
  get headers(): Readonly<Record<string, string>> {
    return Object.fromEntries(this.#headers);
  }

  /** One header's value, or nothing where this set does not carry it. */
  read(name: string): string | undefined {
    return this.#headers.get(name.toLowerCase());
  }

  /**
   * As the mux's middleware: added to whatever answer comes back, so the floor
   * is on every response — including one written by something that failed
   * before it reached a route.
   */
  handle(exchange: { headers: Headers }): void {
    for (const [name, value] of this.#headers) exchange.headers.set(name, value);
  }
}
