/* eslint-disable @next/next/no-img-element */
import React from "react";
import type { FrameworkKey, PlatformKey, Option as BaseOption } from "./model";
import { deriveFrameworksByPlatform } from "./codegen/registry";

type PlatformOption = BaseOption<PlatformKey> & { icon?: React.ReactNode };

export const PLATFORM_OPTIONS: PlatformOption[] = [
  { key: "typescript", label: "TypeScript", icon: <img src="/images/external-icons/typescript.svg" alt="TypeScript" /> },
  { key: "python", label: "Python", icon: <img src="/images/external-icons/python.svg" alt="Python" /> },
  { key: "go", label: "Go", icon: <img src="/images/external-icons/golang.svg" alt="Go" /> },
  { key: "java", label: "Java", icon: <img src="/images/external-icons/java.svg" alt="Java" /> },
  { key: "opentelemetry", label: "OpenTelemetry", icon: <img src="/images/external-icons/otel.svg" alt="OpenTelemetry" /> },
  { key: "no_and_lo", label: "No and Low Code", icon: <img src="/images/external-icons/no-and-lo.svg" alt="No and Low Code" /> },
  { key: "other", label: "Other" },
];

export const FRAMEWORKS_BY_PLATFORM = deriveFrameworksByPlatform() as Record<PlatformKey, readonly { key: FrameworkKey; label: string; icon?: React.ReactNode }[]>;
