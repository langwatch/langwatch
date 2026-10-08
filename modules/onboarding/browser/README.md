# @langwatch/onboarding-browser

The browser half of [onboarding](../README.md). What a browser installs when it installs onboarding: the welcome flow, the product-flavour flow and project creation.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/onboarding.web.ts:20` (`defineBrowserModule("onboarding")`), exported as `onboardingWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                          | URL                             | Within | Label | Permission     | Flags |
| --------------------------------- | ------------------------------- | ------ | ----- | -------------- | ----- |
| `pages/onboarding`                | `/onboarding`                   | –      | –     | –              | –     |
| `pages/onboarding/welcome`        | `/onboarding/welcome`           | –      | –     | –              | –     |
| `pages/onboarding/product/index`  | `/onboarding/product`           | –      | –     | –              | –     |
| `pages/onboarding/[team]/project` | `/onboarding/:team/project`     | –      | –     | –              | –     |
| `pages/[project]/setup`           | `/:project/setup` (route table) | –      | –     | `project:view` | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

- Client packages (package.json): `@langwatch/api-key-client`, `@langwatch/enterprise-governance-client`, `@langwatch/identity-client`, `@langwatch/langy-client`, `@langwatch/model-provider-client`, `@langwatch/navigation-client`, `@langwatch/onboarding-client`, `@langwatch/organization-client`.
- Lends: `GuidedTourToken`, `GuidedTourStateToken`, `GuidedPathActiveToken`, `FirstTouchAttributionToken`, `GuidedOnboardingOfferToken`.
- Host APIs it requires: `OnboardingHostApi`, `GuidedOnboardingHostApi`.

<!-- readme:generated:end -->
