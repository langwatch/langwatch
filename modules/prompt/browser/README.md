# @langwatch/prompt-browser

The browser half of [prompt](../README.md). What a browser installs when it installs prompt: the Prompt Studio screen.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/prompt.web.ts:10` (`defineBrowserModule("prompt")`), exported as `promptWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                  | URL                 | Within  | Label   | Permission     | Flags |
| ------------------------- | ------------------- | ------- | ------- | -------------- | ----- |
| `pages/[project]/prompts` | `/:project/prompts` | project | Prompts | `prompts:view` | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

| Drawer         | Opens                                              | Opened from                             |
| -------------- | -------------------------------------------------- | --------------------------------------- |
| `promptList`   | `src/ui/sections/prompt-list-drawer.tsx`           | experiment                              |
| `promptEditor` | `src/ui/sections/prompts/prompt-editor-drawer.tsx` | experiment, navigation, scenario, trace |

Opened from lists the other modules (and `ui`, the app) whose browser source names the drawer in a
`…Drawer("<name>")` call, a `?drawer.open=<name>` link or by its token; a name held in a constant is not followed.

## Calls

- `withApi(promptApi)`, tRPC contracts: `prompts.*`, `promptTags.*`.
- Client packages (package.json): `@langwatch/api-key-client`, `@langwatch/model-provider-client`, `@langwatch/prompt-client`, `@langwatch/trace-client`.
- Host APIs it requires: `PromptHostApi`.
- Capabilities: `llmConfigField`, `llmConfigPopover`, `outputsSection`, `studioPromptEditor`.

<!-- readme:generated:end -->
