import type { IconData } from "../shared/types";
import {
  derivePlatformsForCategory,
  deriveFrameworksByPlatform,
  type IntegrationCategory,
} from "./codegen/registry";
import type { Option as BaseOption, FrameworkKey, PlatformKey } from "./types";

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

/**
 * Returns the platform list trimmed to platforms that actually have at least
 * one entry in the category, paired with that category's frameworks-by-platform
 * map. Used by the traces-v2 empty-state onboarding to swap framework lists
 * when the user toggles between Agents and Traditional.
 */
export function getCategoryOptions(category: IntegrationCategory): {
  platforms: PlatformOption[];
  frameworksByPlatform: Record<
    PlatformKey,
    readonly { key: FrameworkKey; label: string; icon?: IconData }[]
  >;
} {
  const allowed = derivePlatformsForCategory(category);
  return {
    platforms: PLATFORM_OPTIONS.filter((p) => allowed.has(p.key)),
    frameworksByPlatform: deriveFrameworksByPlatform(category) as Record<
      PlatformKey,
      readonly { key: FrameworkKey; label: string; icon?: IconData }[]
    >,
  };
}
