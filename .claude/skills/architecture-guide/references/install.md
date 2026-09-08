# Installing a module into apps/ui

The application does not import screens ad hoc. One registry at the features root is the
only place allowed to compose private modules. Five steps put a screen in front of a
user. The reference is `apps/ui/src/features/annotation`.

1. **The web package exports a flat entry.**
   `@langwatch/<f>-web/<entry>` exports `<f>Screens` (lazy page modules), `<f>Api`
   (the binding) and `<F>HostPort` with its provider (`web.md`).

2. **Declare the use in the catalogue.**
   `apps/ui/src/features/catalogue.json` → `features[]`:

   ```json
   {
     "id": "annotations",
     "root": "annotation",
     "uses": {
       "screens": ["@langwatch/annotation-web/annotations"],
       "surfaces": ["@langwatch/organization-web/personal-workspace-features"]
     }
   }
   ```

   `root` is the private folder under `apps/ui/src/features/`. `ui-web-capability-declaration`
   checks each entry names an exact exported entry; a flat entry under `screens` belongs
   to this one module, under `surfaces` it is shared. `governedWebPackages` lists every
   `*-web` package under the frontend rules; a new web package is added there.

3. **A private module folder adapts the screen to this application.**
   `apps/ui/src/features/<f>/{index.ts, behavior/, ui/sections/<f>-host.tsx, ui/sections/<f>-routes.tsx}`.
   Only `index.ts` may sit at the module root (`ui-feature-layout`). The host component
   implements the web package's `*HostPort` from `useUiCapabilities()` (session,
   navigation, route, feedback) and wraps children in the package's provider. The routes
   file builds pages with `uiPage` and installs them with `lazyRoute`:

   ```ts
   function annotationPage(view: AnnotationView, permission?: string): UiPageLoader {
     return uiPage({
       screen: async () => {
         const Screen = (await annotationScreens.annotations()).default;
         const OnView = () => <Screen view={view} />;
         return { default: OnView };
       },
       host: AnnotationHost,
       ...(permission ? { permission } : {}),
     });
   }

   export const annotationRoutes = [
     { path: "/:project/annotations", ...lazyRoute(annotationPage("inbox", "annotations:view")), handle: { page: "pages/[project]/annotations" } },
     { path: "/:project/annotations/:slug", ...lazyRoute(annotationPage("queue")), handle: { page: "pages/[project]/annotations/[slug]" } },
   ];
   ```

   `uiPage` fixes the wrapping order once: host outermost, then the permission guard
   with the shared fallbacks, then the screen. `handle.page` is the page key the install
   test pins.

4. **The module's `index.ts` is its whole install surface.**

   ```ts
   export const annotationWeb: WebInstallation = {
     name: "annotation",
     install(ui) {
       ui.routes("project", annotationRoutes);
       ui.api(uiApiBinding("@langwatch/annotation-web", annotationApi));
       ui.api(uiApiBinding("@langwatch/organization-web/personal-workspace-features", personalWorkspaceFeaturesApi));
     },
   };
   ```

   One `WebInstallation` (`apps/ui/src/behavior/ui-web-installation.ts`) per module
   directory, added to the `features` list in
   `apps/ui/src/features/installed-ui-features.ts`. `collectWebInstallations` refuses a
   route installed twice and an api binding installed twice, and still accepts the older
   `uiFeature({ name, api, loaders, drawers? })` value while other modules convert.
   `apps/ui/tests/installed-ui-features.unit.test.ts` pins every page key per module;
   `installed-ui-drawers.unit.test.ts` and `installed-ui-drawers.integration.test.tsx`
   pin and open every registered drawer.

5. **Pin the addresses.**
   A `WebInstallation` needs no route-table entry: its routes are spliced under the
   `project` parent where `apps/ui/src/model/ui-route-table.ts` marks
   `webRouteParent: "project"`, and the table otherwise carries only the loader-key pages
   of the older `uiFeature` installs plus `UiRedirectDescriptor` entries for retired
   addresses. What pins a new page is the page-key list in
   `apps/ui/tests/installed-ui-features.unit.test.ts` and the root `feature-map.json`, the
   live public map of routes, MCP tools and CLI commands (see the `feature-map` skill).

## Transport

One tRPC client for the whole browser (`apps/ui/src/behavior/ui-feature-transport.ts`):
`httpBatchLink`, a non-batched `httpLink` and `sseSubscriptionLink`, all superjson.
Module hooks bind through `uiApiBinding(name, api)`. Public config is read from the
meta tag by `apps/ui/src/behavior/public-config.ts`.

## apps/ui's own layout

`src/{model, behavior, ui, features/<f>, styles}` plus `ui.entrypoint.tsx` and
`index.ts`. A file anywhere else fails `ui-root-catch-all`.
Global layers may not import a private module; the registry is the seam.

## Checks after installing

See `gates.md`.
