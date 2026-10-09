# @langwatch/agent-browser

The browser half of [agent](../README.md). What a browser installs when it installs agent: the drawers the address bar opens (`?drawer.open=<name>`).

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

Declared in `src/agent.web.ts:9` (`defineBrowserModule("agent")`), exported as `agentWeb` at `./declaration`.

Installed by ui, from the app's generated module list (`pnpm generate:modules`).

## Screens

| Page key                                    | URL                              | Within | Label | Permission         | Flags |
| ------------------------------------------- | -------------------------------- | ------ | ----- | ------------------ | ----- |
| `runtime/ui/features/agent-ui-host.adapter` | `/:project/agents` (route table) | –      | –     | `evaluations:view` | –     |

A URL marked (route table) is joined from `apps/ui/src/shell/ui-route-table.ts`; the screen declares no `path`.

## Drawers (the name is the wire: `?drawer.open=<name>`)

| Drawer                      | Opens                                                                 | Opened from                    |
| --------------------------- | --------------------------------------------------------------------- | ------------------------------ |
| `agentList`                 | `src/ui/sections/agent-list-drawer.tsx`                               | experiment                     |
| `agentHistory`              | `src/ui/sections/agent-history-drawer.tsx`                            | –                              |
| `agentTypeSelector`         | `src/ui/sections/agent-type-selector-drawer.tsx`                      | navigation, scenario, workflow |
| `agentCodeEditor`           | `src/ui/sections/routed-agent-drawers.tsx`                            | –                              |
| `agentHttpEditor`           | `src/ui/sections/routed-agent-drawers.tsx`                            | scenario                       |
| `agentVoiceEditor`          | `src/features/voice-editor/ui/sections/agent-voice-editor-drawer.tsx` | –                              |
| `agentConnectedDetail`      | `src/ui/sections/routed-agent-drawers.tsx`                            | –                              |
| `agentConnectFromCode`      | `src/ui/sections/routed-agent-drawers.tsx`                            | –                              |
| `agentWorkflowEditor`       | `src/ui/sections/routed-agent-drawers.tsx`                            | scenario                       |
| `agentWorkflowTargetEditor` | `src/ui/sections/routed-agent-drawers.tsx`                            | –                              |
| `workflowSelector`          | `src/ui/sections/routed-agent-drawers.tsx`                            | –                              |

Opened from lists the other modules (and `ui`, the app) whose browser source names the drawer in a
`…Drawer("<name>")` call, a `?drawer.open=<name>` link or by its token; a name held in a constant is not followed.

## Calls

- Client packages (package.json): `@langwatch/agent-client`, `@langwatch/scenario-client`, `@langwatch/trace-client`.
- Lends: `HttpConfigEditorToken`.
- Host APIs it requires: `AgentManagementHostApi`.

<!-- readme:generated:end -->
