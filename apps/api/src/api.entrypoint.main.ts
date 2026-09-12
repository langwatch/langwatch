import process from "node:process";
import { createLogger } from "@langwatch/observability";
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
 * This catch reports what it caught. It used to assume the failure had already
 * reached the error stream and stay silent, which holds only once the process
 * has a logger — and the boot seam resolves secrets and parses config BEFORE
 * that, so the failures most worth seeing are exactly the ones nothing had
 * reported yet. An `InvalidRuntimeConfigError` naming the variables it rejected
 * was being swallowed whole, leaving a process that exits 1 having printed
 * nothing at all, under a supervisor that can only report "exit status 1".
 * `apps/tasks` has always logged here (tasks.entrypoint.main.ts:106); this is
 * the same line.
 */
export async function bootApi(): Promise<void> {
  try {
    const main = await ApiRuntimeBootstrap.create({
      source: process.env,
      composition: new ApiProductionComposition(),
    });
    await main.start();
  } catch (error) {
    createLogger("langwatch:api").error({ error }, "api process failed to boot");
    process.exitCode = 1;
  }
}
