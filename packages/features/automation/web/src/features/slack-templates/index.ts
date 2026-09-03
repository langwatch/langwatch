/**
 * The Slack Block Kit template gallery, as the rest of this package composes it.
 *
 * A private feature's public entry. The Slack delivery provider is the one
 * caller: it offers the gallery when a guided template is what the author
 * wants, and reads the catalogue to seed a default layout for the source the
 * automation is about.
 */

export * from "./ui/elements/registry";
export { SlackBlockKitTemplatePicker } from "./ui/blocks/template-picker";
