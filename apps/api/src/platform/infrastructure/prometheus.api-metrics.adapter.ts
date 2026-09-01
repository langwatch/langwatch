import type { Registry } from "prom-client";
import { ApiMetricsPort } from "../../api-process.lifecycle";

/**
 * Who this process will render its registry to.
 *
 * A discriminated choice rather than an optional key, so a composition root
 * has to say `open` out loud. Spelled the other way — a key that may be
 * absent — "nobody configured a credential" and "everybody may scrape" would
 * be the same value, and the second is a decision no adapter should be able
 * to make on a deployment's behalf.
 */
export type ApiMetricsAccess =
  | { readonly gate: "bearer"; readonly key: string }
  | { readonly gate: "open" };

/** The part of a Prometheus registry a scrape needs. */
export type ApiMetricsRegistry = Pick<Registry, "metrics" | "contentType">;

/**
 * Renders a Prometheus registry over the API process's `/metrics` route,
 * behind the bearer gate its deployment configured.
 *
 * The registry arrives as an argument and is never reached for. That is what
 * lets this adapter be exercised against a private registry, and it is also
 * the whole safety property: {@link ApiMetricsInfrastructure} passes the
 * registry the process's own instrumented packages already write into, and a
 * second registry conjured here would render a syntactically perfect scrape
 * with none of this process's work in it.
 *
 * No algorithm and no metric names live here. What a LangWatch process counts
 * is decided by the packages that count it; what this class owns is who may
 * read the result.
 */
export class PrometheusApiMetricsAdapter extends ApiMetricsPort {
  static create(options: {
    registry: ApiMetricsRegistry;
    access: ApiMetricsAccess;
  }): PrometheusApiMetricsAdapter {
    return new PrometheusApiMetricsAdapter(options.registry, options.access);
  }

  private constructor(
    private readonly registry: ApiMetricsRegistry,
    private readonly access: ApiMetricsAccess,
  ) {
    super();
  }

  /**
   * A refused scrape carries no body, so a caller learns whether it holds the
   * credential and nothing about what this deployment runs. A registry that
   * fails to render is not handled: nothing is known about the cause and there
   * is nothing a scraper could do differently, so it reaches the process's
   * generic failure path with a trace id rather than being dressed up here.
   */
  async respond(request: Request): Promise<Response> {
    if (!this.isAuthorized(request)) {
      return new Response(null, { status: 401 });
    }
    return new Response(await this.registry.metrics(), {
      status: 200,
      headers: { "Content-Type": this.registry.contentType },
    });
  }

  private isAuthorized(request: Request): boolean {
    if (this.access.gate === "open") return true;
    return request.headers.get("authorization") === `Bearer ${this.access.key}`;
  }
}
