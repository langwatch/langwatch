import process from "node:process";
import { ApiHttpListener, type ApiListenerAddress } from "./api-http.listener.ts";
import { ApiProcessLifecycleRoutes } from "./api-process.lifecycle.ts";
import {
  ApiRuntimeBootstrap,
  ApiRuntimeComposition,
  ApiRuntimeProcess,
  type ApiRuntimeCompositionOptions,
} from "./api.main.ts";
import { bootApiProcess } from "./app/api-production.composition.ts";

/**
 * The api process, stated once.
 *
 * The boot seam resolves the secrets and parses the config; this composition
 * says what the process IS - the api role, every installed module, and the
 * listener the role's own lifecycle routes are served on. Each module's
 * declared transports are mounted by boot on the doors this process opens, so
 * there is no family named here and nothing to keep in step when one is added.
 */
class ApiProductionComposition extends ApiRuntimeComposition {
  async compose(options: ApiRuntimeCompositionOptions): Promise<ApiRuntimeProcess> {
    const runtime = await bootApiProcess({
      config: options.config,
      secrets: options.secrets,
    });
    // The process's own lifecycle routes first, then every family boot
    // mounted, in install order. Each mounted family carries its own absolute
    // paths, so this is a route table and not a prefix scheme.
    const application = ApiProcessLifecycleRoutes.create({});
    for (const family of runtime.transports.rest) application.route("/", family);

    const listener = ApiHttpListener.create({
      application,
      port: options.config.port,
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

/**
 * Everything the API process does lives behind one composition, which is the
 * table of what the process is made of.
 *
 * A boot failure has already been written to the error stream by the time this
 * catch runs; what is left to decide here is the exit status, and it is
 * non-zero. Nothing is re-reported: a failure printed twice reads as two
 * failures.
 */
export async function bootApi(): Promise<void> {
  try {
    const main = await ApiRuntimeBootstrap.create({
      source: process.env,
      composition: new ApiProductionComposition(),
    });
    await main.start();
  } catch {
    process.exitCode = 1;
  }
}
