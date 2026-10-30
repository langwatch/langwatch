Feature: `langwatch pi` injects the standard OTel env on one path only
  ADR-188 Decisions 1, 2, 6, 9. pi ships no OTel environment of its own, so the
  wrapper injects the standard `OTEL_EXPORTER_OTLP_*` names and the extension
  installed beside them (pi-extension-install.feature) is what reads them.

  pi has no gateway path. Every model's address is fixed in pi's own build, so
  there is no base-URL swap to make: the platform policy allows OTel direct and
  denies the virtual key, which leaves a single allowed path and no prompt.

  Spans are pi's only signal. The logs and metrics exporters are pinned off so
  an inherited value cannot start an idle exporter against our endpoint.

  Pairs with:
    - specs/ai-governance/cli-wrappers/cli-mints-ingest-key.feature
    - specs/ai-governance/cli-wrappers/wrap-path-choice.feature
    - specs/ai-governance/cli-wrappers/logout.feature

  Background:
    Given the user has completed `langwatch login --device` for org "acme"

  Rule: pi resolves to ingestion without ever offering a gateway

    @unit
    Scenario: pi resolves to the ingestion path even when a virtual key exists
      Given the user has a personal virtual key
      And no tool_mode is saved for pi
      When the wrapper path for "pi" is resolved on a terminal
      Then the path is ingestion
      And the user is not prompted to choose a path

    @unit
    Scenario: pi resolves to ingestion in a non-interactive shell
      Given the session has no terminal
      When the wrapper path for "pi" is resolved
      Then the path is ingestion

    @unit
    Scenario: A pinned gateway mode for pi is refused with a reason
      Given the user runs `langwatch pi --tool-mode gateway`
      When the wrapper path for "pi" is resolved
      Then the run is refused
      And the reason states that pi's model endpoints are fixed in its own build

  Rule: The ingestion env is the standard OTel block, with spans only

    @unit
    Scenario: Ingestion mode mints a pi_cli ingest key and points pi at LangWatch
      Given no cached ingest key exists for "pi_cli"
      When the user runs `langwatch pi`
      Then an ingest key is minted with sourceType "pi_cli"
      And OTEL_EXPORTER_OTLP_ENDPOINT points at the LangWatch OTLP endpoint
      And OTEL_EXPORTER_OTLP_HEADERS carries the ingest key as a Bearer token
      And OTEL_EXPORTER_OTLP_PROTOCOL is "http/json"
      And OTEL_RESOURCE_ATTRIBUTES carries service.name "pi"

    @unit
    Scenario: Only the traces exporter is enabled, because pi emits nothing else
      When the user runs `langwatch pi`
      Then OTEL_TRACES_EXPORTER is "otlp"
      And OTEL_LOGS_EXPORTER is "none"
      And OTEL_METRICS_EXPORTER is "none"

    @unit
    Scenario: An inherited exporter setting from the parent shell is overridden
      Given the parent shell exports OTEL_TRACES_EXPORTER=none
      And the parent shell exports OTEL_EXPORTER_OTLP_ENDPOINT for another collector
      When the user runs `langwatch pi`
      Then the child env's OTEL_TRACES_EXPORTER is "otlp"
      And the child env's OTEL_EXPORTER_OTLP_ENDPOINT is the LangWatch endpoint

    @unit
    Scenario: A cached pi_cli ingest key is reused instead of re-minted
      Given a cached ingest key exists for "pi_cli" and is still live on the platform
      When the user runs `langwatch pi`
      Then no new ingest key is minted

  Rule: Nothing pi-shaped survives a logout

    @unit
    Scenario: Logout strips pi's injected env names
      Given `langwatch pi` has persisted its telemetry env for bare pi runs
      When the user runs `langwatch logout`
      Then pi's injected OTel env names are removed from the persisted block
