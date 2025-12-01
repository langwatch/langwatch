/**
 * LangWatch-specific schemas for the event-sourcing system.
 * These schemas are domain-specific and not part of the generic library.
 *
 * Type identifiers are exported from ./typeIdentifiers.ts to avoid circular dependencies.
 */

// Re-export type identifiers (these are in a separate file to avoid circular deps)
export * from "./typeIdentifiers";
