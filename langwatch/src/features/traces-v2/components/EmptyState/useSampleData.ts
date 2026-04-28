import { useState } from "react";
import { executeTrace } from "~/components/ops/foundry/traceExecutor";
import { toaster } from "~/components/ui/toaster";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { buildSampleTraces } from "./sampleTraceTemplates";

interface UseSampleDataResult {
  loading: boolean;
  load: () => Promise<boolean>;
}

interface UseSampleDataInput {
  /**
   * The Personal Access Token minted at the top of the empty state. When
   * absent, `load()` no-ops with an error toast — sample data is gated on
   * token generation so we don't have to special-case the legacy project
   * key in Foundry's PAT-aware exporter.
   */
  apiKey: string | undefined;
  projectId: string | undefined;
}

/**
 * Coerce anything thrown into a human-readable string. The OTel exporter
 * pipeline can reject with non-`Error` shapes — `ExportResult` objects
 * (`{ code, error }`), arrays of those, AggregateError, etc. A naive
 * `instanceof Error` check produces the useless "Unknown error" toast and
 * a `JSON.stringify` falls back to `[{}]` because OTel's enums + Error
 * classes have non-enumerable fields. So we walk the shape ourselves.
 */
function describeError(error: unknown): string {
  if (error == null) return "Unknown error";
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  if (typeof error === "number" || typeof error === "boolean") {
    return String(error);
  }
  if (Array.isArray(error)) {
    const parts = error
      .map(describeError)
      .filter((s) => s && s !== "Unknown error");
    if (parts.length) return parts.join("; ");
    return `${error.length} error${error.length === 1 ? "" : "s"} (see console)`;
  }
  if (typeof error === "object") {
    const obj = error as Record<string, unknown>;
    // Pull a nested Error first — that's what OTel's ExportResult.error is.
    if (obj.error) {
      const nested = describeError(obj.error);
      if (nested && nested !== "Unknown error") return nested;
    }
    if (typeof obj.message === "string" && obj.message) return obj.message;
    if (typeof obj.statusText === "string" && obj.statusText) {
      return `${obj.status ?? ""} ${obj.statusText}`.trim();
    }
    if (obj.code !== undefined)
      return `Export failed (code ${String(obj.code)})`;
    return "Export failed (see console for details)";
  }
  return String(error);
}

// ~30 traces from hand-crafted Vercel AI SDK + Mastra templates. Each
// trace runs ~3–5 spans (root agent + LLM + optional tool / RAG), so the
// total stays comfortably under the dev server's body cap while still
// spreading across enough traces that the table, drawer, filters, and
// group-by all have something interesting to render.
const SAMPLE_TRACE_COUNT = 30;

/**
 * Module-level pin for the in-flight sample-data sends. After the
 * empty-state component redirects to the populated trace view, it
 * unmounts — and the only references to the unwaited send promises
 * would die with the component's `load()` closure. Browsers can (and
 * sometimes do) abort fetches whose only roots are dead closures, so
 * we keep an explicit strong reference on the module until each send
 * resolves. Self-evicting via `finally` so the set doesn't leak.
 */
const inFlightSampleSends = new Set<Promise<unknown>>();

function pinSend<T>(promise: Promise<T>): Promise<T> {
  inFlightSampleSends.add(promise);
  void promise.finally(() => inFlightSampleSends.delete(promise));
  return promise;
}

/**
 * Hook that mints a representative batch of synthetic traces — half
 * shaped like Vercel AI SDK output, half like Mastra agent runs — and
 * ships them via Foundry's OTLP executor. Every span carries
 * `langwatch.origin = "sample"` (stamped centrally by the executor) so
 * the trace view can redirect to `origin:sample` after generation,
 * isolating sample data from real traffic.
 *
 * Caller passes the empty-state PAT and project id. Foundry's exporter
 * detects the `pat-lw-` prefix and forwards `X-Project-Id` alongside the
 * Bearer token so the unified auth middleware can resolve scope.
 */
export function useSampleData({
  apiKey,
  projectId,
}: UseSampleDataInput): UseSampleDataResult {
  const publicEnv = usePublicEnv();
  // Prefer the live page origin: the OTLP collector is always served from
  // the same origin as the LangWatch app, so a same-origin POST avoids
  // cross-origin auth/CORS failures entirely. In dev, `BASE_HOST` may
  // point at the cloud or a different host than what the user is actually
  // running, so falling through to it would produce a cross-origin
  // request that fails as `Failed to fetch`. Only use BASE_HOST as a
  // last-resort fallback for SSR / non-browser contexts.
  const endpoint =
    (typeof window !== "undefined" ? window.location.origin : "") ||
    publicEnv.data?.BASE_HOST ||
    "https://app.langwatch.ai";

  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    // Surface the resolved endpoint once per mount so misconfigurations
    // (e.g. BASE_HOST overriding the local origin) are obvious from the
    // console rather than only manifesting as opaque fetch failures.
    // eslint-disable-next-line no-console
    console.debug("[useSampleData] OTLP endpoint:", endpoint);
  }
  const [loading, setLoading] = useState(false);

  const load = async (): Promise<boolean> => {
    if (!apiKey || !projectId) {
      toaster.create({
        title: "Generate an access token first",
        description:
          "Sample data ingests through your access token, so we need one before we can populate the trace view.",
        type: "error",
        meta: { closable: true },
      });
      return false;
    }

    setLoading(true);
    try {
      // Fire every trace in parallel — one provider per trace, all kicked
      // off at once. The browser caps concurrent connections per origin
      // (~6 on HTTP/1.1), so the network layer naturally serializes
      // anyway; doing this from JS just removes the artificial stagger.
      // `langwatch.origin = "sample"` is stamped centrally by the
      // Foundry executor.
      const traces = buildSampleTraces(SAMPLE_TRACE_COUNT);

      const failures: string[] = [];
      const sends = traces.map((trace) =>
        // Pin each promise on the module so it isn't GC'd when the
        // empty-state component unmounts post-redirect. The fetch keeps
        // running; the promise self-evicts from the pin on settle.
        pinSend(
          executeTrace({ trace, apiKey, endpoint, projectId }).catch(
            (err: unknown) => {
              failures.push(describeError(err));
              console.warn("[useSampleData] sample trace failed", err);
            },
          ),
        ),
      );

      // Wait only until enough land to make the redirect view feel
      // populated; the rest finish in the background after the user
      // navigates. The empty-state component unmounts on navigate but
      // `executeTrace` keeps its own provider in scope, so the in-flight
      // fetches aren't tied to React lifecycle and continue cleanly.
      const HEAD_COUNT = Math.min(3, sends.length);
      await Promise.race([
        // Settle the first HEAD_COUNT promises so the first few writes
        // are confirmed before we redirect…
        Promise.allSettled(sends.slice(0, HEAD_COUNT)),
        // …but don't block forever if the server is slow.
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);

      if (failures.length === sends.length) {
        // Every send failed before we even got to redirect.
        throw new Error(
          `All ${sends.length} sample traces failed: ${failures[0]}`,
        );
      }

      toaster.create({
        title: "Sample traces are loading",
        description:
          "We'll take you to the view now — the rest will land in a moment.",
        type: "success",
        duration: 5000,
        meta: { closable: true },
      });
      return true;
    } catch (error) {
      // Surface the underlying error in the dev console so non-Error
      // rejections from the OTel pipeline are still debuggable.
      console.error("[useSampleData] failed to load sample data", error);
      toaster.create({
        title: "Couldn't load sample data",
        description: describeError(error),
        type: "error",
        duration: 6000,
        meta: { closable: true },
      });
      return false;
    } finally {
      setLoading(false);
    }
  };

  return { loading, load };
}
