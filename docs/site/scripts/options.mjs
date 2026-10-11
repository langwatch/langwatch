import path from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

export function readBuildOptions({ args = process.argv.slice(2) } = {}) {
  const { values } = parseArgs({ args, options: { "out-dir": { type: "string" } } });
  return { outDir: path.resolve(values["out-dir"] ?? "dist") };
}

export function readPreviewOptions({ args = process.argv.slice(2) } = {}) {
  const { values } = parseArgs({
    args,
    options: { "out-dir": { type: "string" }, port: { type: "string" } },
  });
  return {
    outDir: path.resolve(values["out-dir"] ?? "dist"),
    port: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(values.port ?? 4173),
  };
}
