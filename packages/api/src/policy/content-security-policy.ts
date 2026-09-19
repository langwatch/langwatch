/**
 * The document policy the browser reads off the page that loads the bundle.
 *
 * `app()` is the baseline this product's single-page application needs; a
 * deployment chains sources onto it rather than assembling one from directives,
 * so a directive nobody thought about is still the baseline's.
 */

/** The storage endpoints a deployment uploads to directly, as an origin list. */
export type StorageEndpoints = Readonly<{
  s3Endpoint?: string | undefined;
  s3Region?: string | undefined;
  s3Bucket?: string | undefined;
  awsRegion?: string | undefined;
  azureBlobEndpoint?: string | undefined;
}>;

/**
 * An origin, or nothing where the text is not a usable one. `new URL("file:///x")`
 * does NOT throw — it yields the *string* `"null"`, which in `connect-src`
 * becomes an unquoted `null` source matching sandboxed and `data:` documents.
 */
function originOf(url: string | undefined): string | null {
  if (!url) return null;

  try {
    const { origin } = new URL(url);

    return origin === "null" ? null : origin;
  } catch {
    // A malformed endpoint must never break header construction.
    return null;
  }
}

/**
 * AWS region tokens are `[a-z0-9-]` only — anything else cannot be a real
 * region and, interpolated into the header, would inject CSP directives.
 */
const AWS_REGION = /^[a-z0-9-]+$/;

/**
 * Object-storage origins for `connect-src`: an explicit endpoint, AWS S3 by
 * region, or the Azure blob endpoint. Per-organization endpoints are excluded —
 * a customer's own bucket is not this deployment's to admit (ADR-032 R3).
 */
export function storageConnectSources(endpoints: StorageEndpoints): readonly string[] {
  const origins = new Set<string>();

  const endpoint = originOf(endpoints.s3Endpoint);

  const looksLikeAws = Boolean(
    endpoints.s3Endpoint ?? endpoints.s3Region ?? endpoints.s3Bucket ?? endpoints.awsRegion,
  );

  if (endpoint) {
    origins.add(endpoint);
  } else if (looksLikeAws) {
    // Some AWS or S3 setting is present but no usable explicit endpoint, so the
    // AWS origins for the configured region are the closest true answer.
    const region = (endpoints.s3Region ?? endpoints.awsRegion)?.trim();

    if (region && AWS_REGION.test(region)) {
      origins.add(`https://s3.${region}.amazonaws.com`);
      origins.add(`https://*.s3.${region}.amazonaws.com`);
    } else {
      origins.add("https://*.amazonaws.com");
    }
  }

  const azure = originOf(endpoints.azureBlobEndpoint);
  if (azure) origins.add(azure);

  return [...origins];
}

/** One directive's sources, in the order they were chained on. */
type Directives = ReadonlyMap<string, readonly string[]>;

export class ContentSecurityPolicy {
  /**
   * The single-page application's baseline. Every third-party origin here was
   * added by a measured failure; the comments name the ones that broke in
   * production only, because dev reports rather than enforces.
   */
  static app(): ContentSecurityPolicy {
    return new ContentSecurityPolicy(
      new Map<string, readonly string[]>([
        ["default-src", ["'self'"]],
        // blob: in script-src, not only worker-src: AudioWorklet.addModule() is
        // a script fetch, and the ElevenLabs client (1.23.x) registers worklets
        // from a blob: URL — omitting it broke the voice panel in production
        // only, since dev enforces no policy (#7947).
        [
          "script-src",
          [
            "'self'",
            "'unsafe-eval'",
            "'unsafe-inline'",
            "blob:",
            "https://*.posthog.com",
            "https://cdn.jsdelivr.net",
            "https://cdnjs.cloudflare.com",
            "https://*.googletagmanager.com",
            "https://*.pendo.io",
            "https://client.crisp.chat",
            "https://static.hsappstatic.net",
            "https://*.google-analytics.com",
            "https://www.google.com",
            "https://*.reo.dev",
          ],
        ],
        [
          "style-src",
          [
            "'self'",
            "'unsafe-inline'",
            "https://cdn.jsdelivr.net",
            "https://cdnjs.cloudflare.com",
            "https://*.pendo.io",
            "https://client.crisp.chat",
            "https://*.google.com",
            "https://*.reo.dev",
            "https://fonts.googleapis.com",
            "https://unpkg.com",
          ],
        ],
        [
          "img-src",
          [
            "'self'",
            "blob:",
            "data:",
            "https://cdn.jsdelivr.net",
            "https://cdnjs.cloudflare.com",
            "https://image.crisp.chat",
            "https://*.googletagmanager.com",
            "https://*.pendo.io",
            "https://*.google-analytics.com",
            "https://www.google.com",
            "https://*.reo.dev",
          ],
        ],
        [
          "font-src",
          [
            "'self'",
            "data:",
            "https://cdn.jsdelivr.net",
            "https://cdnjs.cloudflare.com",
            "https://client.crisp.chat",
            "https://www.google.com",
            "https://*.reo.dev",
            "https://fonts.gstatic.com",
          ],
        ],
        ["object-src", ["'none'"]],
        ["base-uri", ["'self'"]],
        ["form-action", ["'self'"]],
        ["frame-ancestors", ["'none'"]],
        ["worker-src", ["'self'", "blob:"]],
        // Voice agents: the browser talks to ElevenLabs directly over the
        // signed ConvAI websocket the platform mints (#7947).
        [
          "connect-src",
          [
            "'self'",
            "https://api.elevenlabs.io",
            "wss://api.elevenlabs.io",
            "https://*.posthog.com",
            "https://*.pendo.io",
            "wss://*.pendo.io",
            "wss://client.relay.crisp.chat",
            "https://client.crisp.chat",
            "https://*.googletagmanager.com",
            "https://analytics.google.com",
            "https://stats.g.doubleclick.net",
            "https://*.google-analytics.com",
            "https://www.google.com",
            "https://*.reo.dev",
          ],
        ],
        [
          "frame-src",
          [
            "'self'",
            "https://*.posthog.com",
            "https://*.pendo.io",
            "https://www.youtube.com",
            "https://get.langwatch.ai",
            "https://*.googletagmanager.com",
            "https://www.google.com",
            "https://*.reo.dev",
          ],
        ],
      ]),
      { reportOnly: false, upgradeInsecureRequests: false },
    );
  }

  readonly #directives: Directives;
  readonly #reportOnly: boolean;
  readonly #upgradeInsecureRequests: boolean;

  private constructor(
    directives: Directives,
    flags: { reportOnly: boolean; upgradeInsecureRequests: boolean },
  ) {
    this.#directives = directives;
    this.#reportOnly = flags.reportOnly;
    this.#upgradeInsecureRequests = flags.upgradeInsecureRequests;
  }

  /** Sources appended to one directive, as a new policy. */
  withSources(directive: string, ...sources: readonly string[]): ContentSecurityPolicy {
    if (sources.length === 0) return this;

    const existing = this.#directives.get(directive) ?? [];

    return new ContentSecurityPolicy(
      new Map([...this.#directives, [directive, [...existing, ...sources]]]),
      { reportOnly: this.#reportOnly, upgradeInsecureRequests: this.#upgradeInsecureRequests },
    );
  }

  /** The endpoints the page may `fetch` or open a socket to. */
  withConnectSource(...sources: readonly string[]): ContentSecurityPolicy {
    return this.withSources("connect-src", ...sources);
  }

  /** The origins the page may load script from. */
  withScriptSource(...sources: readonly string[]): ContentSecurityPolicy {
    return this.withSources("script-src", ...sources);
  }

  /**
   * An asset origin admitted into every fetch directive the browser needs to
   * load chunks, styles, fonts, images and workers from (ADR-086). One call
   * rather than six, because admitting it to five of six is a silent 404.
   */
  withAssetOrigin(origin: string | null): ContentSecurityPolicy {
    if (origin === null) return this;

    return [
      "script-src",
      "style-src",
      "img-src",
      "font-src",
      "worker-src",
      "connect-src",
    ].reduce<ContentSecurityPolicy>(
      (policy, directive) => policy.withSources(directive, origin),
      this,
    );
  }

  /**
   * Reported rather than enforced. Development reports the very policy
   * production enforces, so a directive that would break production shows up
   * as a console violation on the first local run instead of after a deploy.
   */
  reportOnly(reportOnly = true): ContentSecurityPolicy {
    return new ContentSecurityPolicy(this.#directives, {
      reportOnly,
      upgradeInsecureRequests: this.#upgradeInsecureRequests,
    });
  }

  /** `upgrade-insecure-requests`, which only a TLS-terminated deployment wants. */
  upgradingInsecureRequests(upgrade = true): ContentSecurityPolicy {
    return new ContentSecurityPolicy(this.#directives, {
      reportOnly: this.#reportOnly,
      upgradeInsecureRequests: upgrade,
    });
  }

  /** The policy text, without the header name. */
  get value(): string {
    const directives = [...this.#directives].map(
      ([directive, sources]) => `${directive} ${sources.join(" ")}`,
    );

    const upgrade = this.#upgradeInsecureRequests ? ["upgrade-insecure-requests"] : [];

    return [...directives, ...upgrade].join("; ");
  }

  /** The header this policy is sent as: enforcing, or reporting. */
  asHeader(): Readonly<{ name: string; value: string }> {
    return {
      name: this.#reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
      value: this.value,
    };
  }
}
