# Design system

`@langwatch/design-system` owns LangWatch's browser-safe Chakra system, shared
components, and their isolated documentation surface. It must not import the
host app, a feature package, routing, transport, or server code.

## Storybook

Start the component workshop with `pnpm --filter @langwatch/design-system
storybook`. Build its static form with `pnpm --filter @langwatch/design-system
build:storybook`.

Stories mount the package's `DesignSystemProvider`, not Chakra's default
system. The toolbar controls the real light and dark colour modes, so every
story documents the tokens a consuming app receives. The accessibility addon
is enabled for each story; use Storybook's Vitest addon when interaction or
browser-level story tests are introduced.

## Catalogue taxonomy

Use Storybook's sidebar to describe the stability and intended reuse level:

- **Foundations**: token visualizations and non-component rules such as colour,
  typography, spacing, elevation, and motion.
- **Primitives**: small accessible building blocks that remain broadly
  composable.
- **Components**: named reusable controls or display units with a stable API.
- **Patterns**: deliberate, app-independent compositions already owned by this
  package. Do not add a pattern merely to reproduce an app screen.

This avoids forcing every UI element into an atoms/molecules hierarchy while
leaving a clear place for future prefab compositions.
