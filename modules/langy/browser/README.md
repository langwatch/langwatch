# @langwatch/langy-browser

The browser half of [langy](../README.md). What a browser installs when it installs langy: the layout its dock draws in, the host that dock reads, and the api its hooks run on. Langy draws inside other modules' pages, which is why its host mounts above the tree.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/langy.web.ts:17` (`defineBrowserModule("langy")`), exported as `langyWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                | URL | Within | Label | Permission | Flags |
| ----------------------- | --- | ------ | ----- | ---------- | ----- |
| `layouts/project-langy` | –   | –      | –     | –          | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

- `withApi(langyApi)`, tRPC contracts: –.
- Client packages (package.json): `@langwatch/feature-flag-client`, `@langwatch/github-client`, `@langwatch/langy-client`, `@langwatch/model-provider-client`, `@langwatch/onboarding-client`.
- Lends: `GuidedOnboardingToken`.
- Host APIs it requires: `LangyHostApi`.

<!-- readme:generated:end -->
