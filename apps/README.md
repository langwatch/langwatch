# Apps

An app is `main.ts` and `config.ts`; no product code (CLAUDE.md). ui, api and worker always run together: a stack missing the worker serves pages and silently processes no jobs. The `*-web` apps are the consoles haven and the simulators serve (ADR-160).

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

| App              | Package                     | Installs           | What it is (package.json `description`)                                                                                                                                                                                                         |
| ---------------- | --------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api`            | `@langwatch/platform-api`   | 64 process modules | LangWatch interactive API process composition.                                                                                                                                                                                                  |
| `backend`        | `@langwatch/backend`        | –                  | The api and the worker in one Node process: the backend `npx @langwatch/server` runs (ADR-168). The seam lives in @langwatch/process.                                                                                                           |
| `docs`           | `@langwatch/docs-site`      | –                  | Prerendered documentation app: static HTML and agent exports, shared design-system React at build time, and small lazy browser islands.                                                                                                         |
| `haven-web`      | `@langwatch/haven-web`      | –                  | The haven hub and every stack's home page: a React bundle built by Vite into tools/thuishaven/adapters/dashboard/web/dist and served by that Go process (ADR-160).                                                                              |
| `scenario-child` | `@langwatch/scenario-child` | –                  | The scenario child process, as its own program and its own bundle.                                                                                                                                                                              |
| `server`         | `@langwatch/server`         | –                  | Run LangWatch locally with one command — `npx @langwatch/server`. Complete LangWatch stack: observability, evaluations, AI gateway, agent simulations.                                                                                          |
| `sims`           | `@langwatch/sims`           | –                  | The simulators' consoles (llm, mail, idp, payment, storage, analytics, outbound, telemetry, voice, lambda, mcp): one multi-page React app built by Vite into services/sims/simconsole/dist, each page served by its own Go simulator (ADR-160). |
| `tasks`          | `@langwatch/tasks`          | 64 process modules | One-shot database migrations and provisioning, run in command-line order.                                                                                                                                                                       |
| `ui`             | `@langwatch/ui`             | 45 browser modules | LangWatch browser process composition.                                                                                                                                                                                                          |
| `worker`         | `@langwatch/worker`         | 64 process modules | LangWatch background process composition.                                                                                                                                                                                                       |

Installs counts the entries of the app's generated module list (`pnpm generate:modules`).

<!-- readme:generated:end -->
