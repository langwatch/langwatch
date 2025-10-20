import type { PlatformKey } from "../types";

export function platformToFileName(key: PlatformKey): string {
  switch (key) {
    case "typescript":
      return "app.ts";
    case "python":
      return "app.py";
    case "go":
      return "main.go";
    case "opentelemetry":
      return "opentelemetry.yaml";
    default:
      return "";
  }
}


