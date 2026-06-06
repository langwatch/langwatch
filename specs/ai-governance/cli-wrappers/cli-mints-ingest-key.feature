Feature: CLI Wrappers — `langwatch <tool>` mints and uses an ingestion key (Path B)
  As a developer running `langwatch claude` (or codex / gemini / opencode)
  in OTLP-ingestion mode (Path B, no gateway virtual key)
  I want the wrapper to obtain a project-scoped ingestion key and inject it
  into the wrapped tool's OTLP exporter
  So that the tool's telemetry lands in my personal project with one command,
  using the same `sk-lw-` ingestion-key credential the dashboard shows me

  Context (replaces the retired binding flow):
    Path B no longer mints an `ik-lw-` UserIngestionBinding. The wrapper asks
    the control plane for the personal project's ingestion key for the tool's
    sourceType (SOURCE_TYPE_BY_TOOL: claude->claude_code, codex->codex,
    gemini->gemini, opencode->opencode), an ApiKey(keyType="ingest"). The token
    is cached in ~/.langwatch/config.json and injected as
    `OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer sk-lw-..."`.

  Background:
    Given the user has completed `langwatch login` (device-flow) for org "acme"
    And the user has a personal project "personal-jane"

  @bdd @cli-wrappers @ingest-key @mint
  Scenario: First `langwatch claude` in ingestion mode mints the ingest key
    Given tool_mode.claude is unset and no personal virtual key exists
    When the user runs `langwatch claude`
    Then the wrapper resolves mode = ingestion (no VK present)
    And it fetches the personal-project ingestion key for sourceType "claude_code"
    And the key is an `sk-lw-` ApiKey(keyType="ingest") bound to "personal-jane"
    And the wrapper sets OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <sk-lw token>"
    And the token is cached in ~/.langwatch/config.json (mode 0600)

  @bdd @cli-wrappers @ingest-key @reuse
  Scenario: A second run reuses the cached ingest key without re-minting
    Given a prior `langwatch claude` cached an ingestion key
    When the user runs `langwatch claude` again
    Then the wrapper reuses the cached `sk-lw-` token
    And it does NOT mint a new key

  @bdd @cli-wrappers @ingest-key @per-tool
  Scenario Outline: Each tool gets an ingest key for its own sourceType
    When the user runs `langwatch <tool>` in ingestion mode
    Then the wrapper fetches an ingestion key for sourceType "<sourceType>"
    And injects it into the tool's OTLP exporter env

    Examples:
      | tool     | sourceType  |
      | claude   | claude_code |
      | codex    | codex       |
      | gemini   | gemini      |
      | opencode | opencode    |

  @bdd @cli-wrappers @ingest-key @policy-gate
  Scenario: allow_otel_direct = false short-circuits before minting
    Given the platform tool policy for "acme" + "claude" has allow_otel_direct = false
    When the user runs `langwatch claude` and ingestion mode is resolved
    Then the wrapper does NOT mint or fetch an ingestion key
    And it surfaces that direct OTLP ingestion is disabled by the org admin
    # The policy gate sits above the ingest-key fetch (see cli-tool-mode-policy.feature).
