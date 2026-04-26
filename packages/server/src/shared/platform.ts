import { arch, platform } from "node:os";

export type SupportedPlatform = "darwin-arm64" | "darwin-x64" | "linux-arm64" | "linux-x64";

export class UnsupportedPlatformError extends Error {
  constructor(readonly raw: string) {
    super(
      `${raw} is not supported. Run via WSL2 on Windows, or use docker compose: https://docs.langwatch.ai/self-hosting/docker-compose`
    );
    this.name = "UnsupportedPlatformError";
  }
}

export function detectPlatform(): SupportedPlatform {
  const os = platform();
  const cpu = arch();
  const slug = `${os}-${cpu}`;
  if (
    slug === "darwin-arm64" ||
    slug === "darwin-x64" ||
    slug === "linux-arm64" ||
    slug === "linux-x64"
  ) {
    return slug;
  }
  throw new UnsupportedPlatformError(slug);
}

export function isMac(): boolean {
  return platform() === "darwin";
}
