# Installing a feature into apps/ui

The application does not import screens ad hoc. One registry at the features root is the
only place allowed to compose private features. Five steps put a screen in front of a user.

1. **The web package exports a screen entry.**
   `@langwatch/<f>-web/screens/<f>` exports `<f>Screens` (lazy page modules),
   `<f>Api` (the binding) and `<F>HostPort`.

2. **Declare the use in the catalogue.**
   `apps/ui/src/features/catalogue.json` → `features[]`:

   ```json
   {
     "id": "secret",
     "root": "secret",
     "uses": { "screens": ["@langwatch/secret-web/screens/secret"], "surfaces": [] }
   }
   ```

   `ui-web-capability-declaration` checks each entry names an exact exported
   `screens/*` or `surfaces/*`; `ui-screen-owner` requires a screen's id to equal the
   consuming feature's id. `governedWebPackages` lists every `*-web` package under the
   frontend rules; a new web package is added there.

3. **A private feature folder adapts the screen to this application.**
   `apps/ui/src/features/<f>/{index.ts, model/, behavior/, ui/sections/<f>-routes.tsx}`.
   Only `index.ts` may sit at the feature root (`ui-feature-layout`). The routes file
   builds page loaders:

   ```ts
   const secretsPage: UiPageLoader = async () => {
     const module = await secretScreens.secrets();
     const guarded = withUiPageGuard({ fallbacks })(module.default as ComponentType);
     return { default: withSecretHost(withUiSettingsLayout(guarded)) };
   };
   export const secretPageLoaders: UiPageLoaderRegistry = { "pages/settings/secrets": secretsPage };
   ```

   Host provider outermost, chrome next, permission guard innermost. The host
   implementation of `<F>HostPort` lives here too (session, project, navigation).

4. **The feature's `index.ts` is its whole install surface.**
   One `uiFeature({ name, api, loaders, drawers? })` value per feature directory
   (`apps/ui/src/behavior/ui-feature.ts`), added to the `features` list in
   `apps/ui/src/features/installed-ui-features.ts`. `installUiFeatures` composes the
   loaders, the api bindings and every feature's drawer map into one install;
   `installedUiFeatures.drawers` is re-exported as `installedUiDrawers`.
   `apps/ui/tests/installed-ui-features.unit.test.ts` and
   `apps/ui/tests/installed-ui-drawers.unit.test.ts` pin the sets, and
   `apps/ui/tests/installed-ui-drawers.integration.test.tsx` opens every registered drawer.

5. **Name the page in the route table.**
   `apps/ui/src/model/ui-route-table.ts` carries the loader KEY, never an import, so a
   page can move into a package without the table changing. Retired addresses stay as
   `UiRedirectDescriptor` entries. Then update the root `feature-map.json`, the live
   public map of routes, MCP tools and CLI commands (see the `feature-map` skill).

## The install shape

```ts
export type UiFeatureInstall = {
  loaders?: UiPageLoaderRegistry; // pages this package serves; replaces the host's
  apis?: readonly UiFeatureApiBinding[]; // one per feature package with mounted hooks
  failures?: readonly UiFailureInterceptor[]; // readers of a failed mutation
  capabilities?: UiCapabilityInstall; // ports the composing app answers itself
  transport?: UiFeatureApiTransport; // same-origin when absent
  session?: UiSessionSource; // absent: the session port refuses by name
};
```

`createUiApplication(install)` in `installed-ui-features.composition.ts` merges the
standing declaration over the host's and builds the router from the route table.

## Transport

One tRPC client for the whole browser (`apps/ui/src/behavior/ui-feature-transport.ts`):
`httpBatchLink`, a non-batched `httpLink` and `sseSubscriptionLink`, all superjson.
Feature hooks bind through `uiFeature({ api })`. Public config is read from the meta tag
by `apps/ui/src/behavior/public-config.ts`.

## apps/ui's own layout

`src/{model, behavior, ui, features/<f>, styles}` plus `ui.entrypoint.tsx` and
`index.ts`. A file anywhere else fails `ui-root-catch-all`.
Global layers may not import a private feature; the registry is the seam.

## Checks after installing

See `gates.md`.
