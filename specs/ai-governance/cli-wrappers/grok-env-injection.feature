# `langwatch grok` and `langwatch instrument grok`, Grok's environment
#
# Implementation:
#   sdks/typescript/src/cli/utils/governance/otel-env-block.ts  (SOURCE_TYPE_BY_TOOL and buildOtelEnvBlock)
#   sdks/typescript/src/cli/commands/ingestion/install.ts       (SUPPORTED_TOOLS)
#   sdks/typescript/src/cli/program.ts                          (the `grok` wrapper command)
#   sdks/typescript/src/cli/commands/wrap.ts                    (runWrapped)
#   sdks/typescript/src/cli/utils/governance/shell-rc.ts        (the persisted exports)
#   sdks/typescript/src/cli/utils/governance/wrapper-mode.ts    (ingestion-only routing)
#   sdks/typescript/src/cli/utils/governance/telemetry-targets.ts (logout removal)
#
# Related specs:
#   specs/ai-governance/cli-wrappers/copilot-env-injection.feature , the same shape for Copilot
#   specs/ai-governance/cli-wrappers/cli-mints-ingest-key.feature
#   specs/ai-governance/cli-wrappers/shell-rc-persistence.feature
#   specs/ai-governance/cli-wrappers/grok-hook-install.feature
#   specs/ai-governance/ingestion-sources/grok-cli-otlp.feature
#
# Motivation: Grok exports nothing unless `GROK_EXTERNAL_OTEL=1` is set, and
# then reads the standard OTEL_* variables. Captured against grok 1.0.70:
#   - GROK_EXTERNAL_OTEL=1 turns the external exporter on;
#   - OTEL_LOGS_EXPORTER and OTEL_METRICS_EXPORTER must each be "otlp";
#   - the endpoint, headers and protocol are the standard three;
#   - OTEL_LOG_USER_PROMPTS, OTEL_LOG_ASSISTANT_RESPONSES, OTEL_LOG_TOOL_DETAILS
#     and OTEL_LOG_TOOL_CONTENT each gate one kind of content;
#   - OTEL_RESOURCE_ATTRIBUTES is read by nothing.
#
# Grok is ingestion-only (Copilot's `code` row): its model endpoint is set in
# `config.toml`, never by environment, so there is no gateway path to inject.

Feature: Grok environment injection

  Background:
    Given the user has completed `langwatch login --device` for org "acme"

Rule: Grok's env block turns on its exporter and points it at LangWatch

  @unit
  Scenario: The env block enables Grok's external exporter for logs and metrics
    When the env block for "grok" is built with an endpoint and a token
    Then GROK_EXTERNAL_OTEL is "1"
    And OTEL_LOGS_EXPORTER is "otlp"
    And OTEL_METRICS_EXPORTER is "otlp"
    And OTEL_EXPORTER_OTLP_PROTOCOL is "http/protobuf"
    And OTEL_EXPORTER_OTLP_ENDPOINT is the endpoint
    And OTEL_EXPORTER_OTLP_HEADERS carries the token as a Bearer token

  @unit
  Scenario: The env block turns every content gate on
    When the env block for "grok" is built
    Then OTEL_LOG_USER_PROMPTS, OTEL_LOG_ASSISTANT_RESPONSES, OTEL_LOG_TOOL_DETAILS and OTEL_LOG_TOOL_CONTENT are each "1"

  @unit
  Scenario: The env block sets no traces exporter and no resource attributes
    When the env block for "grok" is built
    Then it sets no OTEL_TRACES_EXPORTER
    And it sets no OTEL_RESOURCE_ATTRIBUTES

  @unit
  Scenario: The grok tool's key is minted for the grok_cli source type
    When the source type for the "grok" tool is looked up
    Then it is "grok_cli"
    And looking "grok_cli" up the other way gives the "grok" tool

Rule: `langwatch grok` runs Grok with that environment

  @unit
  Scenario: The wrapper mints a grok_cli key and runs Grok with the env block
    Given no cached ingest key exists for "grok_cli"
    When the user runs `langwatch grok -p "hello"`
    Then an ingest key is minted with sourceType "grok_cli"
    And Grok is run with the user's arguments unchanged and the env block in its environment

  @unit
  Scenario: A cached grok_cli key is reused
    Given a cached ingest key for "grok_cli" that is still live
    When the user runs `langwatch grok`
    Then no new ingest key is minted

  @unit
  Scenario: The wrapper never offers a gateway path for Grok
    When the user runs `langwatch grok` for the first time
    Then no choice between gateway and direct telemetry is offered
    And Grok runs in ingestion mode, even with a virtual key on file

  @unit
  Scenario: An inherited exporter that points elsewhere is overridden for the child
    Given the parent shell exports OTEL_LOGS_EXPORTER=none
    When the user runs `langwatch grok`
    Then the child's OTEL_LOGS_EXPORTER is "otlp"

  @unit
  Scenario: Wrapper help passes through to Grok
    When the user runs `langwatch grok --help`
    Then Grok's own help is shown

Rule: `langwatch instrument grok` persists the environment and the hook

  @unit
  Scenario: Instrumenting Grok writes its exports to the shell rc file once
    When `langwatch instrument grok` runs twice
    Then the shell rc file carries exactly one LangWatch block of Grok's exports

  @unit
  Scenario: Instrumenting Grok also installs its hook file
    When `langwatch instrument grok` runs
    Then LangWatch's Grok hook file is present

  @unit
  Scenario: Logout removes Grok's exports and its hook file
    Given Grok was instrumented
    When the user logs out
    Then the shell rc file carries none of Grok's exports
    And LangWatch's Grok hook file is gone
