/**
 * The name of the global the built bundle resolves its asset URLs through.
 *
 * ADR-086: the base for content-hashed assets is chosen at container start, not
 * at build time, so one image serves a self-hosted deployment same-origin and
 * SaaS from a commit-prefixed CDN. The build emits every JS-referenced asset URL
 * as a call to this global (see `experimental.renderBuiltUrl` in
 * `vite.config.ts`), and the process that serves the HTML shell defines it.
 *
 * It lives on the browser side because the browser is what reads it. The
 * serving process names the same global when it writes the shell — today that
 * is `platform/app/src/server/asset-base.ts`, and when that module moves to
 * `apps/api` it should import this constant rather than declare a second one
 * that agrees today.
 */
export const UI_ASSET_URL_GLOBAL = "__lwAssetUrl";
