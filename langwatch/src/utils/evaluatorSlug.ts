import { customAlphabet } from "nanoid";
import { slugify } from "./slugify";

/**
 * Maximum length for the base slug (before nanoid suffix)
 * Keeps total slug under ~60 chars which is reasonable for URLs
 */
const MAX_BASE_SLUG_LENGTH = 50;

/**
 * Length of the nanoid suffix appended to ensure uniqueness
 */
const NANOID_SUFFIX_LENGTH = 5;

/**
 * Custom nanoid generator that excludes hyphens to avoid breaking slug parsing.
 * Uses lowercase alphanumeric characters only for cleaner slugs.
 */
const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", NANOID_SUFFIX_LENGTH);

/**
 * Generates a human-readable slug for an evaluator.
 * Format: slugified-name-XXXXX (where XXXXX is a 5-char nanoid)
 *
 * @param name - The evaluator name to slugify
 * @returns A slug like "my-custom-evaluator-abc12"
 *
 * @example
 * generateEvaluatorSlug("My Custom Evaluator") // "my-custom-evaluator-abc12"
 * generateEvaluatorSlug("LLM Judge (v2.0)") // "llm-judge-v2-0-xyz99"
 */
export function generateEvaluatorSlug(name: string): string {
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error("Evaluator name cannot be empty");
  }

  // Slugify the name
  let baseSlug = slugify(trimmedName);

  // Truncate if too long
  if (baseSlug.length > MAX_BASE_SLUG_LENGTH) {
    baseSlug = baseSlug.substring(0, MAX_BASE_SLUG_LENGTH);
    // Remove trailing hyphen if we cut mid-word
    baseSlug = baseSlug.replace(/-$/, "");
  }

  // Generate unique suffix
  const suffix = nanoid();

  // Combine with hyphen separator
  return baseSlug ? `${baseSlug}-${suffix}` : suffix;
}

/**
 * Validates that a string is a valid evaluator slug format.
 *
 * @param slug - The slug to validate
 * @returns true if valid, false otherwise
 */
export function isValidEvaluatorSlug(slug: string): boolean {
  // Must be non-empty
  if (!slug || typeof slug !== "string") {
    return false;
  }

  // Must only contain lowercase letters, numbers, and hyphens
  // Must not start or end with hyphen
  // Must have at least 5 chars (for the nanoid suffix)
  const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

  return slugPattern.test(slug) && slug.length >= NANOID_SUFFIX_LENGTH;
}
