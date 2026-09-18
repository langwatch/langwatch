import { Config, type ConfigOwner } from "@langwatch/config";
import { storesOwner } from "@langwatch/process-stores/config";
import { z } from "zod";

import { observabilityOwner } from "./observability-owner.ts";
import { processOwner } from "./owner.ts";
import { apiOwner } from "./transport/config-owner.ts";

const port = z.coerce.number().int().min(0).max(65535);

/** The role decides which variable spells this process's port. */
const processSettings = (role: "api" | "worker") =>
  Config.define((c) => ({
    port:
      role === "worker"
        ? c.env("WORKER_METRICS_PORT", port.default(2999))
        : c.env("API_PORT", port.default(6560)),
    shutdownDeadlineMs: c.env(
      "PROCESS_SHUTDOWN_DEADLINE_MS",
      z.coerce.number().int().positive().default(60000),
    ),
  }));

/** Framework owners and installed module owners feed the same config parser. */
export function processConfig<const Modules extends readonly ConfigOwner[]>(
  modules: Modules,
  role: "api" | "worker" = "api",
) {
  const process = {
    ...processOwner,
    config: { ...processOwner.config, ...processSettings(role) },
  } as const;
  return [process, storesOwner, apiOwner, observabilityOwner, ...modules] as const;
}
