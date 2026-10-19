# @langwatch/annotation-browser

The browser half of [annotation](../README.md). What a browser installs when it installs annotation: the five screens the product routes today and the surfaces other modules mount.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/annotation.web.ts:29` (`defineBrowserModule("annotation")`), exported as `annotationWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                               | URL                              | Within   | Label             | Permission         | Flags |
| -------------------------------------- | -------------------------------- | -------- | ----------------- | ------------------ | ----- |
| `pages/[project]/annotations`          | `/:project/annotations`          | project  | Annotations       | `annotations:view` | –     |
| `pages/[project]/annotations/all`      | `/:project/annotations/all`      | project  | –                 | –                  | –     |
| `pages/[project]/annotations/me`       | `/:project/annotations/me`       | project  | –                 | –                  | –     |
| `pages/[project]/annotations/my-queue` | `/:project/annotations/my-queue` | project  | –                 | –                  | –     |
| `pages/[project]/annotations/[slug]`   | `/:project/annotations/:slug`    | project  | –                 | –                  | –     |
| `pages/settings/annotation-scores`     | `/settings/annotation-scores`    | settings | Annotation Scores | `annotations:view` | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

| Drawer                     | Opens                                                | Opened from |
| -------------------------- | ---------------------------------------------------- | ----------- |
| `addOrEditAnnotationScore` | `src/ui/sections/routed-annotation-score-drawer.tsx` | trace       |

Opened from lists the other modules (and `ui`, the app) whose browser source names the drawer in a
`…Drawer("<name>")` call, a `?drawer.open=<name>` link or by its token; a name held in a constant is not followed.

## Calls

- Client packages (package.json): `@langwatch/annotation-client`, `@langwatch/trace-client`.
- Lends: `AnnotateBodyToken`, `SuggestBodyToken`, `AnnotationFormFooterToken`.
- Host APIs it requires: `AnnotationHostApi`, `AnnotationScoresHostApi`.

<!-- readme:generated:end -->
