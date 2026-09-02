/**
 * What the browser application may reach for outside a screen.
 *
 * The popup ceremony only: `platform/app`'s Langy connect card opens the same
 * GitHub installation window the Integrations settings screen does, and this
 * package is where that behaviour lives. Deletes-only forbids repointing that
 * caller, so this root export stays while it does — the same standing
 * `@langwatch/ops-web` and `@langwatch/user-web` roots carry, recorded in
 * `dev/docs/plans/ui-family-move-manifests.md`.
 *
 * The Integrations SCREEN is not here. It is an owner-only export under
 * `./screens/integrations`, which is what ADR-004 asks of a screen.
 */

export * from "./behavior/github-connect-popup";
