# @langwatch/enterprise-billing-browser

The browser half of [billing](../README.md). What a browser installs when it installs billing: the Plans, Subscription and Usage settings screens. Always installed — billing refuses per-organization on entitlement, it never gates itself by tier.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/billing.web.ts:15` (`defineBrowserModule("billing")`), exported as `billingWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                      | URL                      | Within   | Label        | Permission          | Flags |
| ----------------------------- | ------------------------ | -------- | ------------ | ------------------- | ----- |
| `pages/settings/plans`        | `/settings/plans`        | settings | Plans        | `organization:view` | –     |
| `pages/settings/subscription` | `/settings/subscription` | settings | Subscription | –                   | –     |
| `pages/settings/usage`        | `/settings/usage`        | settings | Usage        | `cost:view`         | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

None.

## Calls

- Client packages (package.json): `@langwatch/enterprise-billing-client`, `@langwatch/enterprise-licensing-client`.
- Lends: `LicenseBillingSectionToken`, `ContactSalesToken`, `SeatProrationPreviewToken`.
- Host APIs it requires: `BillingHostApi`.
- Config slices: `billing`.

<!-- readme:generated:end -->
