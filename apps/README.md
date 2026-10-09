# Apps

An app is `main.ts` and `config.ts`; no product code (CLAUDE.md). ui, api and worker always run together: a stack missing the worker serves pages and silently processes no jobs. The `*-web` apps are the consoles haven and the simulators serve (ADR-160).

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

| App                | Package                       | Installs           | What it is (package.json `description`)                                                                                                                                                            |
| ------------------ | ----------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `analyticssim-web` | `@langwatch/analyticssim-web` | –                  | The analytics simulator's console (PostHog and Customer.io records): a React bundle built by Vite into services/analyticssim/web/dist and served by that Go process (ADR-160).                     |
| `api`              | `@langwatch/platform-api`     | 63 process modules | LangWatch interactive API process composition.                                                                                                                                                     |
| `haven-web`        | `@langwatch/haven-web`        | –                  | The haven hub and every stack's home page: a React bundle built by Vite into tools/thuishaven/adapters/dashboard/web/dist and served by that Go process (ADR-160).                                 |
| `idpsim-web`       | `@langwatch/idpsim-web`       | –                  | The IdP simulator's console: a React bundle built by Vite into services/idpsim/web/dist and served by that Go process (ADR-160).                                                                   |
| `llmsim-web`       | `@langwatch/llmsim-web`       | –                  | The LLM simulator's console: a React bundle built by Vite into services/llmsim/web/dist and served by that Go process (ADR-160).                                                                   |
| `mailsim-web`      | `@langwatch/mailsim-web`      | –                  | The mail sink's inbox: a React bundle built by Vite into services/mailsim/web/dist and served by that Go process (ADR-160).                                                                        |
| `outboundsim-web`  | `@langwatch/outboundsim-web`  | –                  | The outbound simulator's console (Slack, webhook and SQS records, deliveries and faults): a React bundle built by Vite into services/outboundsim/web/dist and served by that Go process (ADR-160). |
| `scenario-child`   | `@langwatch/scenario-child`   | –                  | The scenario child process, as its own program and its own bundle.                                                                                                                                 |
| `server`           | `@langwatch/server`           | –                  | Run LangWatch locally with one command — `npx @langwatch/server`. Complete LangWatch stack: observability, evaluations, AI gateway, agent simulations.                                             |
| `storagesim-web`   | `@langwatch/storagesim-web`   | –                  | The S3 stand-in's console: a React bundle built by Vite into services/storagesim/web/dist and served by that Go process (ADR-160).                                                                 |
| `tasks`            | `@langwatch/tasks`            | 63 process modules | One-shot database migrations and provisioning, run in command-line order.                                                                                                                          |
| `telemetrysim-web` | `@langwatch/telemetrysim-web` | –                  | The telemetry simulator's console (start, watch and stop seeded OTLP runs): a React bundle built by Vite into services/telemetrysim/web/dist and served by that Go process (ADR-160).              |
| `ui`               | `@langwatch/ui`               | 45 browser modules | LangWatch browser process composition.                                                                                                                                                             |
| `voicesim-web`     | `@langwatch/voicesim-web`     | –                  | The voice simulator's console: a React bundle built by Vite into services/voicesim/web/dist and served by that Go process (ADR-160).                                                               |
| `worker`           | `@langwatch/worker`           | 63 process modules | LangWatch background process composition.                                                                                                                                                          |

Installs counts the entries of the app's generated module list (`pnpm generate:modules`).

<!-- readme:generated:end -->
