import { createRequire } from "node:module";

import type * as otelInstrumentation from "@opentelemetry/instrumentation";
import type * as otelSdkMetrics from "@opentelemetry/sdk-metrics";

/**
 * Loads an optional peer on first use, so a process that never passes a
 * metric reader or instrumentations never pays for the package. Required,
 * not imported, so the failure is one message naming what to install.
 */
declare const __ESM_MODULE_URL__: string;

function requireOptionalPeer<Module>({
  packageName,
  neededFor,
}: {
  packageName: string;
  neededFor: string;
}): Module {
  try {
    // The CJS build has __filename; tsup.config.ts swaps in import.meta.url for ESM.
    const base = typeof __filename === "string" ? __filename : __ESM_MODULE_URL__;
    return createRequire(base)(packageName) as Module;
  } catch (cause) {
    throw new Error(
      `${neededFor} needs ${packageName}, which is not installed. Install it next to langwatch: npm install ${packageName}`,
      { cause },
    );
  }
}

export function loadInstrumentation(): typeof otelInstrumentation {
  return requireOptionalPeer<typeof otelInstrumentation>({
    packageName: "@opentelemetry/instrumentation",
    neededFor: "Passing instrumentations",
  });
}

export function loadSdkMetrics(): typeof otelSdkMetrics {
  return requireOptionalPeer<typeof otelSdkMetrics>({
    packageName: "@opentelemetry/sdk-metrics",
    neededFor: "Passing a metricReader",
  });
}
