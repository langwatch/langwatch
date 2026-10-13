# scenariorunner

The Go scenario runner: a drop-in for the Node scenario child (`apps/scenario-child`). The worker
spawns it the same way, with the same environment, writes one job to its stdin and reads the last
JSON line of its stdout with the same `parseResult`. It runs the job on the Go scenario SDK
(`github.com/langwatch/scenario/go`). Contract: `specs/scenarios/go-scenario-runner.feature`.

## Build

```bash
cd services && go build -o scenariorunner ./scenariorunner/cmd/scenariorunner
```

The worker image builds it in the `scenariorunner` stage of `infra/docker/Dockerfile` and names its
path in `SCENARIO_GO_RUNNER_PATH`. A project's non-voice runs move to it while the
`release_scenario_go_runner_enabled` flag is on (`specs/scenarios/go-scenario-runner-choice.feature`).

It is its own binary, not a `service` subcommand: the mono-binary refuses to boot with
`LANGWATCH_API_KEY` set, and a run's minted key arrives in exactly that variable.

## Environment

| Variable                                                              | Read as                                                                     |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `LANGWATCH_ENDPOINT`, `LANGWATCH_API_KEY`                             | where events and spans go, and the run's key; required                      |
| `LANGWATCH_SCENARIO_EGRESS_POLICY`                                    | `{"blockLocal":bool,"allowedHosts":[...]}`; required, never defaulted       |
| `LANGWATCH_NLP_INTERNAL_SECRET`                                       | sent as `X-LangWatch-NLP-Secret` on every engine call                       |
| `LANGWATCH_LOG_CONTEXT`                                               | bound to every log line (run, batch, project, scenario, set ids)            |
| `OTEL_RESOURCE_ATTRIBUTES`                                            | the spans' resource (`langwatch.origin.source=platform`, `scenario.labels`) |
| `NODE_TLS_REJECT_UNAUTHORIZED`, `NODE_EXTRA_CA_CERTS`                 | the TLS policy of an HTTP target call                                       |
| `NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS`, `NLP_FETCH_MAX_TIMEOUT_MS` | engine deadlines of a simulation                                            |
| `SCENARIO_VERBOSE`, `LOG_LEVEL`, `OTEL_SERVICE_NAME`                  | output detail and naming                                                    |

Stdout carries the SDK's banners and, last, the result line. Logs are JSON on stderr.

## Layout

| Package                                | Holds                                                                |
| -------------------------------------- | -------------------------------------------------------------------- |
| `scenariorunner`                       | job parsing, result lines, the run itself, telemetry                 |
| `targets`                              | one adapter per target type: HTTP, prompt, code, workflow, connected |
| `egress`                               | the outbound fence, over `pkg/ssrf`                                  |
| `llm`                                  | the model each role runs on, through the engine's LiteLLM proxy      |
| `internal/jsjson`, `internal/jsonpath` | JSON as JavaScript writes it, and the path subset targets use        |
