Feature: CLI Wrappers — `langwatch <tool>` mints and uses an ingestion key (Path B)
  As a developer running `langwatch claude` (or codex / gemini / opencode)
  in OTLP-ingestion mode (Path B, no gateway virtual key)
  I want the wrapper to obtain a project-scoped ingestion key and inject it
  into the wrapped tool's OTLP exporter
  So that the tool's telemetry lands in my personal project with one command,
  using the same `ik-lw-` ingestion-key credential the dashboard shows me

  Context (replaces the retired binding flow):
    Path B no longer mints the retired UserIngestionBinding. The wrapper asks
    the control plane for the personal project's ingestion key for the tool's
    sourceType (SOURCE_TYPE_BY_TOOL: claude->claude_code, codex->codex,
    gemini->gemini, opencode->opencode), an ApiKey(keyType="ingest") with the
    `ik-lw-` prefix. The token is cached in ~/.langwatch/config.json and
    injected as `OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ik-lw-..."`.

    Two kinds of credential outrank the personal mint path entirely:
      - A tool pinned to a team project (`tool_project_keys[tool]`, written
        by `langwatch instrument` or the wrapper's `--project` flag).
      - A secret the user pasted by hand into the personal cache that is not
        a personal `ik-lw-` token (a project key, a legacy shape).
    Both are used verbatim: never probed against the personal key listing,
    never re-minted, never overwritten. Revocation surfaces on the ingest
    side instead.

  Background:
    Given the user has completed `langwatch login` (device-flow) for org "acme"
    And the user has a personal project "personal-jane"

  @bdd @cli-wrappers @ingest-key @mint
  Scenario: First `langwatch claude` in ingestion mode mints the ingest key
    Given tool_mode.claude is unset and no personal virtual key exists
    When the user runs `langwatch claude`
    Then the wrapper resolves mode = ingestion (no VK present)
    And it fetches the personal-project ingestion key for sourceType "claude_code"
    And the key is an `ik-lw-` ApiKey(keyType="ingest") bound to "personal-jane"
    And the wrapper sets OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <ik-lw token>"
    And the token is cached in ~/.langwatch/config.json (mode 0600)

  @bdd @cli-wrappers @ingest-key @reuse
  Scenario: A second run reuses the cached ingest key without re-minting
    Given a prior `langwatch claude` cached an ingestion key
    When the user runs `langwatch claude` again
    Then the wrapper reuses the cached `ik-lw-` token
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

  Rule: pinned credentials are used verbatim and never overwritten

    @unit @cli-wrappers @ingest-key @pinned
    Scenario: A hand-pinned foreign key is reused verbatim and never overwritten
      Given the cached ingest key for "codex" is a secret the user pasted
        by hand, not a personal `ik-lw-` token
      When the wrapper resolves the ingestion credential
      Then the cached secret is injected exactly as stored
      And the CLI does NOT probe the personal key listing
      And it does NOT mint a replacement key
      # Probing a foreign secret always reads "revoked" (the personal
      # listing can never contain it), so probing meant re-minting over
      # the user's explicit choice on every run.

    @unit @cli-wrappers @ingest-key @project-pin
    Scenario: A project-pinned tool sends with the pinned key and no personal mint
      Given `tool_project_keys.codex` carries a project ingest key
      And a personal cached key for "codex" also exists
      When the wrapper resolves the ingestion credential for codex
      Then the pinned project key wins over the personal cache
      And no server call is made to list or mint personal keys
      And the resolution reports the project scope with the pinned
        project's slug

    @unit @cli-wrappers @ingest-key @project-pin
    Scenario: The pin's endpoint override routes to the self-hosted instance
      Given `tool_project_keys.claude` carries a pasted key and an
        endpoint override
      When the wrapper resolves the ingestion credential for claude
      Then the OTLP endpoint derives from the pin's endpoint,
        not from the login's control plane

    @unit @cli-wrappers @ingest-key @project-pin
    Scenario: The wrapper keeps a pinned tool on the pinned project
      Given codex is pinned to a team project
      And a personal virtual key and a remembered gateway preference exist
      When the user runs `langwatch codex`
      Then the wrapper resolves ingestion mode with the pinned secret
      And no personal key is minted or probed
      And the run reports where the telemetry goes

    @unit @cli-wrappers @ingest-key @project-pin
    Scenario: A pinned tool fails rather than rerouting onto the gateway
      Given codex is pinned to a team project
      And the organization turned direct OTLP off for codex
      When the user runs `langwatch codex`
      Then the run fails with otel_direct_disabled
      And no personal key is minted
      # Rerouting silently would move the project's telemetry, and its
      # billing, onto the personal gateway path.
