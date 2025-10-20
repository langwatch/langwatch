/* eslint-disable @next/next/no-img-element */

import type { FrameworkKey, PlatformKey, Option } from "./types";
import { deriveFrameworksByPlatform } from "./codegen/registry";

export const PLATFORM_OPTIONS: Option<PlatformKey>[] = [
  { key: "typescript", label: "TypeScript", icon: <img src="/images/external-icons/typescript.svg" alt="TypeScript" /> },
  { key: "python", label: "Python", icon: <img src="/images/external-icons/python.svg" alt="Python" /> },
  { key: "go", label: "Go", icon: <img src="/images/external-icons/golang.svg" alt="Go" /> },
  { key: "opentelemetry", label: "OpenTelemetry", icon: <img src="/images/external-icons/otel.svg" alt="OpenTelemetry" /> },
  { key: "no_and_lo", label: "No and Low Code", icon: <img src="/images/external-icons/no-and-lo.svg" alt="No and Low Code" /> },
  { key: "other", label: "Other" },
];

export const FRAMEWORKS_BY_PLATFORM = deriveFrameworksByPlatform() as Record<PlatformKey, readonly Option<FrameworkKey>[]>;

export type GoFrameworkKey = (typeof FRAMEWORKS_BY_PLATFORM)["go"][number]["key"];
