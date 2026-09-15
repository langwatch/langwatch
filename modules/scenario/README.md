# Scenario

`scenario` owns authored scenario definitions and portable scenario UI.

- `contract` defines the tenant-scoped service contract, parameter schema, input
  mapping and template rendering.
- `server` provides the process-owned service and private persistence adapter.
- `web` provides the Scenario Library, onboarding, archive confirmation,
  selection state, target selector and controlled authoring form.

The application owns routes, tRPC queries and mutations, project identity,
drawer submission and Langy integration. It adapts those through controlled
props and explicit render ports; the web package never imports application
aliases or generated Prisma types.
