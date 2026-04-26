import { execa } from "execa";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Predep, DetectionResult } from "./types.ts";

async function resolveVersion(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execa(bin, ["--version"], { reject: false });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export const uvPredep: Predep = {
  id: "uv",
  label: "uv (Python package manager)",
  required: true,

  async detect(paths): Promise<DetectionResult> {
    const candidates = [
      join(paths.bin, "uv"),
      join(process.env.HOME ?? "", ".local", "bin", "uv"),
      "uv",
    ];
    for (const c of candidates) {
      if (c === "uv" || existsSync(c)) {
        const v = await resolveVersion(c);
        if (v) return { installed: true, version: v, resolvedPath: c };
      }
    }
    return { installed: false, reason: "uv binary not found on PATH or in ~/.langwatch/bin" };
  },

  async install({ paths, task }) {
    task.output = "downloading installer from astral.sh/uv";
    const env = { ...process.env, UV_INSTALL_DIR: paths.bin, UV_NO_MODIFY_PATH: "1" };
    const child = execa("sh", ["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"], {
      env,
      stderr: "pipe",
      stdout: "pipe",
    });
    child.stdout?.on("data", (d) => {
      task.output = String(d).split("\n").filter(Boolean).pop() ?? task.output;
    });
    child.stderr?.on("data", (d) => {
      task.output = String(d).split("\n").filter(Boolean).pop() ?? task.output;
    });
    await child;
    const bin = join(paths.bin, "uv");
    const version = (await resolveVersion(bin)) ?? "unknown";
    return { version, resolvedPath: bin };
  },
};
