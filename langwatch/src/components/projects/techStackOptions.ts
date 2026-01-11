/**
 * Tech stack options for project creation.
 * Uses IconData pattern from onboarding for consistent visual styling.
 */
import type { IconData } from "../../features/onboarding/regions/shared/types";
import { singleIcon, themedIcon } from "../../features/onboarding/regions/shared/types";

export type LanguageKey = "python" | "typescript" | "other";
export type FrameworkKey =
  | "openai"
  | "azure_openai"
  | "vercel_ai"
  | "langchain"
  | "dspy"
  | "other";

export interface LanguageOption {
  key: LanguageKey;
  label: string;
  icon: IconData;
}

export interface FrameworkOption {
  key: FrameworkKey;
  label: string;
  icon: IconData;
  availableFor: LanguageKey[];
}

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  {
    key: "python",
    label: "Python",
    icon: singleIcon("/images/external-icons/python.svg", "Python"),
  },
  {
    key: "typescript",
    label: "TypeScript",
    icon: singleIcon("/images/external-icons/typescript.svg", "TypeScript"),
  },
  {
    key: "other",
    label: "Other",
    icon: singleIcon("/images/external-icons/custom.svg", "Other"),
  },
] as const;

export const FRAMEWORK_OPTIONS: readonly FrameworkOption[] = [
  {
    key: "openai",
    label: "OpenAI",
    icon: themedIcon(
      "/images/external-icons/openai-lighttheme.svg",
      "/images/external-icons/openai-darktheme.svg",
      "OpenAI",
    ),
    availableFor: ["python", "typescript"],
  },
  {
    key: "azure_openai",
    label: "Azure OpenAI",
    icon: singleIcon("/images/external-icons/ms-azure.svg", "Azure OpenAI"),
    availableFor: ["python", "typescript"],
  },
  {
    key: "vercel_ai",
    label: "Vercel AI SDK",
    icon: themedIcon(
      "/images/external-icons/vercel-lighttheme.svg",
      "/images/external-icons/vercel-darktheme.svg",
      "Vercel AI SDK",
    ),
    availableFor: ["typescript"],
  },
  {
    key: "langchain",
    label: "LangChain",
    icon: themedIcon(
      "/images/external-icons/langchain-lighttheme.svg",
      "/images/external-icons/langchain-darktheme.svg",
      "LangChain",
    ),
    availableFor: ["python", "typescript"],
  },
  {
    key: "dspy",
    label: "DSPy",
    icon: singleIcon("/images/external-icons/dspy.webp", "DSPy"),
    availableFor: ["python"],
  },
  {
    key: "other",
    label: "Other",
    icon: singleIcon("/images/external-icons/custom.svg", "Other"),
    availableFor: ["python", "typescript", "other"],
  },
] as const;

/**
 * Get frameworks available for a given language.
 */
export function getFrameworksForLanguage(
  language: LanguageKey
): readonly FrameworkOption[] {
  return FRAMEWORK_OPTIONS.filter((fw) => fw.availableFor.includes(language));
}

/**
 * Get the default framework for a language (first available).
 */
export function getDefaultFramework(language: LanguageKey): FrameworkKey {
  const frameworks = getFrameworksForLanguage(language);
  return frameworks[0]?.key ?? "other";
}

/**
 * Check if a framework is available for a language.
 */
export function isFrameworkAvailableForLanguage(
  framework: FrameworkKey,
  language: LanguageKey
): boolean {
  const option = FRAMEWORK_OPTIONS.find((fw) => fw.key === framework);
  return option?.availableFor.includes(language) ?? false;
}
