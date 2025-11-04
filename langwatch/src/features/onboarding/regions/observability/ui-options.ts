import type { FrameworkKey, PlatformKey, Option as BaseOption } from "./model";
import { deriveFrameworksByPlatform, type IconData } from "./codegen/registry";

type PlatformOption = BaseOption<PlatformKey> & { iconUrl?: string };

export const PLATFORM_OPTIONS: PlatformOption[] = [
  {
    key: "typescript",
    label: "TypeScript",
    iconUrl: "/images/external-icons/typescript.svg",
  },
  {
    key: "python",
    label: "Python",
    iconUrl: "/images/external-icons/python.svg",
  },
  {
    key: "go",
    label: "Go",
    iconUrl: "/images/external-icons/golang.svg",
  },
  {
    key: "java",
    label: "Java",
    iconUrl: "/images/external-icons/java.svg",
  },
  {
    key: "no_and_lo",
    label: "No and Low Code",
    iconUrl: "/images/external-icons/no-and-lo.svg",
  },
  {
    key: "opentelemetry",
    label: "OpenTelemetry",
    iconUrl: "/images/external-icons/otel.svg",
  },
];

export const FRAMEWORKS_BY_PLATFORM = deriveFrameworksByPlatform() as Record<
  PlatformKey,
  readonly { key: FrameworkKey; label: string; icon?: IconData }[]
>;
