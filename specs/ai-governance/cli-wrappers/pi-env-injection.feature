# `langwatch pi`, the standard OTel env block on the one path pi has
#
# Implementation:
#   sdks/typescript/src/cli/utils/governance/otel-env-block.ts  (the per-tool env block and sourceType map)
#   sdks/typescript/src/cli/utils/governance/wrapper-mode.ts    (path resolution, and the gated-mode swap)
#   sdks/typescript/src/cli/utils/governance/shell-rc.ts        (the persisted block a bare `pi` run reads)
#   sdks/typescript/src/cli/utils/governance/telemetry-targets.ts (what logout finds and removes)
#
# Related specs:
#   specs/ai-governance/cli-wrappers/cli-mints-ingest-key.feature  , the key this block carries
#   specs/ai-governance/cli-wrappers/wrap-path-choice.feature      , the path resolution this follows
#   specs/ai-governance/cli-wrappers/pi-extension-install.feature  , what reads the block
#   specs/ai-governance/cli-wrappers/logout.feature                , the teardown this plugs into
#   specs/ai-governance/ingestion-sources/pi-cli-otlp.feature       , where the spans land
#
# Motivation: pi ships no OTel environment of its own, so the wrapper injects
# the standard `OTEL_EXPORTER_OTLP_*` names and the extension reads them as its
# backend. The wrapper injects the env and nothing else: the extension itself is
# written by `langwatch ingest install pi_cli`, specified in
# specs/ai-governance/cli-wrappers/pi-extension-install.feature.
#
# pi has no gateway path. Every model's address is fixed in pi's own build, so
# there is no base URL to swap. That is a property of pi, not a user error, so a
# `--tool-mode gateway` pin is not refused: the wrapper swaps it for ingestion,
# says so once, and forgets the pin. Refusing would stop a run over something
# the user cannot act on.
#
# Spans are pi's only signal, so the traces exporter is the only one pointed at
# LangWatch and the other two are pinned off. Leaving them unset is not the same
# as switching them off: the backend reading this block is our own extension on
# the OTel JS SDK, which autoconfigures from these names, so an unset logs or
# metrics name starts an exporter with nothing to send. codex omits both names
# safely because codex ships its own exporter and never reads them.
#
# The protocol is pinned to `http/protobuf`, which is what our own extension
# speaks. `http/json` is set for gemini alone, whose built-in exporter speaks
# nothing else; pi has no built-in exporter to accommodate.
#
# EVERY SCENARIO HERE IS @unimplemented ON PURPOSE, and only until it binds.
# ADR-188 is proposed; none of what it describes is built. Tagging these @unit
# or @integration now would report a binding that does not exist. Each scenario
# names the tag it becomes in a comment above it, and the commit that makes one
# pass swaps that tag and adds the `@scenario "<title>"` annotation in the same
# change. A scenario still carrying @unimplemented when ADR-188 is called done
# is work that was not done.
#
# WHAT BLOCKS THESE, AS OF 2026-10-30:
#   1. `pi` IS NOT A WRAPPED TOOL. otel-env-block.ts
#      (sdks/typescript/src/cli/utils/governance/) switches on claude_code,
#      codex, gemini, opencode, copilot and code; there is no pi arm, so
#      `langwatch pi` injects nothing and resolves no path.
#   2. THE EXPORTER PINS DEPART FROM THE NEAREST PRECEDENT. ADR-188's Constants
#      pin OTEL_LOGS_EXPORTER and OTEL_METRICS_EXPORTER to "none" because our
#      own extension reads them through the OTel JS SDK. codex, the only other
#      span-only tool here, omits both names instead. Whoever writes the pi arm
#      follows the record, not codex, and this file says why.
#
# The file yields no enforced scenario while that holds, so it is listed in
# LEGACY_INERT in packages/architecture-enforcer/src/tools/check-feature-parity.ts.
# The commit that binds the first scenario here deletes that line with it.

Feature: `langwatch pi` injects the standard OTel env on one path only

  Background:
    Given the user has completed `langwatch login --device` for org "acme"

  Rule: pi resolves to ingestion without ever offering a gateway

    # becomes @unit
    @unimplemented
    Scenario: pi resolves to the ingestion path even when a virtual key exists
      Given the user has a personal virtual key
      And no tool_mode is saved for pi
      When the wrapper path for "pi" is resolved on a terminal
      Then the path is ingestion
      And the user is not prompted to choose a path

    # becomes @unit
    @unimplemented
    Scenario: pi resolves to ingestion in a non-interactive shell
      Given the session has no terminal
      When the wrapper path for "pi" is resolved
      Then the path is ingestion

    # becomes @unit
    @unimplemented
    Scenario: A pinned gateway mode for pi is swapped for ingestion with one notice
      Given the user runs `langwatch pi --tool-mode gateway`
      When the wrapper path for "pi" is resolved
      Then the path is ingestion
      And one notice says pi supports direct OTLP ingestion only
      And the saved gateway pin for pi is forgotten
      And pi still runs

  Rule: The ingestion env is the standard OTel block, with spans only

    # becomes @unit
    @unimplemented
    Scenario: Ingestion mode mints a pi_cli ingest key and points pi at LangWatch
      Given no cached ingest key exists for "pi_cli"
      When the user runs `langwatch pi`
      Then an ingest key is minted with sourceType "pi_cli"
      And the injected env carries:
        | name                         | value                                 |
        | OTEL_EXPORTER_OTLP_ENDPOINT  | the LangWatch OTLP endpoint           |
        | OTEL_EXPORTER_OTLP_HEADERS   | the ingest key as a Bearer token      |
        | OTEL_EXPORTER_OTLP_PROTOCOL  | http/protobuf                         |
        | OTEL_RESOURCE_ATTRIBUTES     | service.name=pi                       |

    # becomes @unit
    @unimplemented
    Scenario: A cached pi_cli ingest key is reused instead of re-minting
      Given a cached ingest key exists for "pi_cli" and is still live on the platform
      When the user runs `langwatch pi`
      Then no new ingest key is minted

    # becomes @unit
    @unimplemented
    Scenario: Traces export to LangWatch and the other two signals are pinned off
      When the user runs `langwatch pi`
      Then the injected env carries:
        | name                  | value |
        | OTEL_TRACES_EXPORTER  | otlp  |
        | OTEL_LOGS_EXPORTER    | none  |
        | OTEL_METRICS_EXPORTER | none  |
      And neither name is left unset for the SDK to default

    # becomes @unit
    @unimplemented
    Scenario: An inherited exporter setting from the parent shell is overridden
      Given the parent shell exports OTEL_TRACES_EXPORTER=none
      And the parent shell exports OTEL_EXPORTER_OTLP_ENDPOINT for another collector
      When the user runs `langwatch pi`
      Then the child env carries:
        | name                        | value                       |
        | OTEL_TRACES_EXPORTER        | otlp                        |
        | OTEL_EXPORTER_OTLP_ENDPOINT | the LangWatch OTLP endpoint |

  Rule: Nothing pi-shaped survives a logout

    # becomes @unit
    @unimplemented
    Scenario: Logout strips pi's injected env names
      Given `langwatch pi` has persisted its telemetry env for bare pi runs
      When the user runs `langwatch logout`
      Then pi's injected OTel env names are removed from the persisted block
      And pi is listed among the telemetry targets logout scans
