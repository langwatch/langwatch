import process from "node:process";
import { createLogger } from "@langwatch/observability";
import { ApiHttpListener, type ApiListenerAddress } from "./api-http.listener.ts";
import { ApiProcessLifecycleRoutes } from "./api-process.lifecycle.ts";
import { createDiscoveryApp } from "./features/discovery/discovery.app.ts";
import {
  ApiRuntimeBootstrap,
  ApiRuntimeComposition,
  ApiRuntimeProcess,
  type ApiRuntimeBootstrapOptions,
  type ApiRuntimeCompositionOptions,
} from "./api.main.ts";
import { bootApiProcess } from "./app/api-production.composition.ts";

// Boot seam resolves secrets and config; this composition says what the
// process IS - the api role, every installed module, and listener.
class ApiProductionComposition extends ApiRuntimeComposition {
  async compose(options: ApiRuntimeCompositionOptions): Promise<ApiRuntimeProcess> {
    const { runtime, trpc, staticSurface } = await bootApiProcess({
      config: options.config,
      secrets: options.secrets,
    });
    // The process's own lifecycle routes first, then the tRPC door - the
    // request lane at /api/trpc and the subscription lane over the same
    // router - then every REST family boot mounted, in install order. Each
    // mounted family carries its own absolute paths, so this is a route table
    // and not a prefix scheme.
    const application = ApiProcessLifecycleRoutes.create({});
    application.route("/", trpc.door(runtime.transports.trpc));
    for (const family of runtime.transports.rest) application.route("/", family);
    // The OpenAPI description and its discovery locations, served by the
    // process itself: the document describes every family at once, so no
    // module's own declaration can carry it (see discovery.app.ts).
    application.route("/", createDiscoveryApp());

    const listener = ApiHttpListener.create({
      application,
      port: options.config.port,
      // The built browser bundle, ahead of the Hono application and declining
      // every address the families declare; see api-production.composition.ts.
      ...(staticSurface ? { staticSurface } : {}),
    });

    return new (class extends ApiRuntimeProcess {
      async start(): Promise<ApiListenerAddress | undefined> {
        await runtime.start();
        return listener.start();
      }

      async close(): Promise<void> {
        try {
          await listener.close();
        } finally {
          await runtime.stop();
        }
      }
    })();
  }
}

// Report all boot errors: logger may not exist yet when config/secrets fail.
export async function bootApi(): Promise<void> {
  try {
    const main = await ApiRuntimeBootstrap.create({
      source: process.env,
      composition: new ApiProductionComposition(),
    });
    await main.start();
  } catch (error) {
    createLogger("langwatch:api").error({ error }, "api process failed to boot");
    // Exit outright: pollers a half-built graph already started would
    // otherwise hold the event loop open, spinning on closed clients.
    process.exit(1);
  }
}

// Embedded API receives environment only; standalone owns signals.
export type ApiExecutableHost = Readonly<{
  env: Readonly<Record<string, unknown>>;
}>;

export type StartStandaloneApiOptions = Readonly<{
  host?: ApiExecutableHost;
  /**
   * Reuses an observability graph another application in this process already
   * built. Setting the SDK up a second time in one process is what prints
   * "OpenTelemetry is already set up"; a standalone deployment never sets this.
   */
  observability?: ApiRuntimeBootstrapOptions["observability"];
}>;

// Embedded start: same composition, no signals or exit status.
export async function startStandaloneApi(
  options: StartStandaloneApiOptions = {},
): Promise<ApiRuntimeBootstrap> {
  const main = await ApiRuntimeBootstrap.create({
    source: options.host?.env ?? process.env,
    composition: new ApiProductionComposition(),
    ...(options.observability ? { observability: options.observability } : {}),
    signals: false,
  });
  await main.start();
  return main;
}
