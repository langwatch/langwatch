/**
 * The Slack Block Kit template gallery, as the rest of this package
 * composes it: a private feature's public entry, whose one caller (the
 * Slack delivery provider) offers the gallery and seeds default layouts.
 */

export * from "./ui/elements/registry.ts";
export { SlackBlockKitTemplatePicker } from "./ui/blocks/template-picker.tsx";
