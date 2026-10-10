import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createLogger } from "@langwatch/observability";

import type { TaskInput } from "./config.ts";

export async function prismaMigrate({ config, environment, signal }: TaskInput): Promise<void> {
  if (config.skipPrismaMigrate) {
    createLogger("langwatch:tasks:prisma-migrate").info(
      "SKIP_PRISMA_MIGRATE is set — skipping Prisma migrations",
    );
    return;
  }

  const configPath = fileURLToPath(new URL("../prisma.config.ts", import.meta.url));
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "prisma", "migrate", "deploy", "--config", configPath], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdio: "inherit",
      env: { ...environment },
      signal,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`prisma migrate deploy exited with code ${code}`));
    });
  });
}
