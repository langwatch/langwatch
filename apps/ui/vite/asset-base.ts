/**
 * The global the built bundle resolves asset URLs through — ADR-086:
 * base chosen at container start, not build time, so one image serves
 * self-hosted same-origin and SaaS from a CDN.
 */
export const UI_ASSET_URL_GLOBAL = "__lwAssetUrl";
