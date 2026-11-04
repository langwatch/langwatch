# Grok CLI OTLP logs and metrics, received under a personal ingest key
#
# Implementation:
#   enterprise/modules/governance/contract/src/features/ingestion/otlp-receiver-policy.ts      (what an ingest key may stamp, and the coding-agent origin)
#   enterprise/modules/governance/contract/src/features/ingestion/ingestion-source-key.commands.ts (the personal source types a key is minted for)
#   enterprise/modules/governance/contract/src/platform-tool-policy.ts                         (the per-tool path policy an org admin sets)
#   enterprise/modules/governance/contract/src/ai-tool-catalog.ts                              (the catalogue slug the billable lookup asks with)
#   modules/coding-agent/process/src/rules/coding-agent-log-facts.rules.ts                      (where the event name and cost are lifted)
#   modules/log/process/src/rules/canonical-log-correlation.rules.ts                           (the synthesized trace id a logs-only session groups under)
#
# Related specs:
#   specs/ai-governance/ingestion-sources/claude-code-otlp.feature , the logs shape Grok copies
#   specs/coding-agent/grok-sessions.feature                     , the session the records fold into
#   specs/coding-agent/grok-model-calls.feature                  , what the lifted figures are used for
#   specs/ai-governance/cli-wrappers/grok-env-injection.feature  , how the records are addressed at us
#   dev/docs/adr/192-grok-as-a-natively-instrumented-coding-agent.md
#
# Motivation: Grok (xAI's coding CLI, `grok` 1.0.70 captured on 2026-11-01)
# ships Claude Code's telemetry design almost key for key: OTLP log records
# named `grok_code.<event>`, one `session.id` on every turn event, a
# `prompt.id` per turn, an `event.sequence`, and metrics named
# `grok_code.token.usage` and `grok_code.cost.usage`. It exports no spans.
#
# Three things differ from Claude Code and each is written down below:
#   - Grok IGNORES `OTEL_RESOURCE_ATTRIBUTES`. Its resource is fixed
#     (`service.name=grok-cli`, scope `ai.xai.grok_code`), so attribution can
#     only come from the ingest key the Bearer header carries, never from a
#     resource attribute the wrapper sets.
#   - The event name rides the LogRecord `event_name` field, not an
#     `event.name` attribute. The log-facts rule already copies it across.
#   - Cost arrives as integer micro-dollars, `cost_usd_micros`.
#
# The capture used for fixtures had the user's email, xAI user id and team id
# on every record. Fixtures are scrubbed before they are committed.

Feature: Grok CLI OTLP ingestion

  Grok exports OTLP/HTTP protobuf, gzip-compressed, logs and metrics only,
  with the ingest key in an Authorization Bearer header. The receiver treats it
  like any other personal coding-agent source: the key decides the
  organisation, the user and the origin; Grok's own records decide nothing
  about attribution.

  Out of scope: a gateway path (Grok routes model traffic through
  `config.toml` model entries, not environment, so there is nothing for the
  wrapper to point at the gateway), and the ACP `grok agent stdio` surface,
  which was not captured.

Rule: A grok_cli key stamps coding-agent provenance

  @unit
  Scenario: A Grok log record ingested under its own key carries the coding-agent origin
    Given a personal ingest key minted for source type "grok_cli"
    And one Grok log record named "grok_code.user_prompt"
    When the receiver applies the key's policy
    Then the record's resource carries langwatch.source "grok_cli"
    And it carries langwatch.origin "coding_agent"
    And it carries the key's organisation id and api key id

  @unit
  Scenario: Grok metrics are stamped the same way as its logs
    Given a personal ingest key minted for source type "grok_cli"
    And one Grok metrics batch holding grok_code.token.usage
    When the receiver applies the key's policy
    Then the batch's resource carries langwatch.source "grok_cli" and the coding-agent origin

  @unit
  Scenario: Provenance keys Grok sends itself are stripped before the key's are stamped
    Given a Grok log record whose resource claims langwatch.source "claude_code"
    When the receiver applies the grok_cli key's policy
    Then the record carries langwatch.source "grok_cli" and nothing else under that key

Rule: grok_cli is a personal source type an org can govern

  @unit
  Scenario: A personal ingest key can be minted for grok_cli
    Given a signed-in member of an organisation whose platform policy allows Grok's direct OTLP path
    When the CLI asks for a personal ingest key for "grok_cli"
    Then the key is minted for that member with source type "grok_cli"

  @unit
  Scenario: Grok's platform policy has no virtual-key path
    Given the default platform tool policies
    When the policy for the "grok" tool slug is read
    Then direct OTLP is allowed
    And the virtual-key path is not allowed

  @unit
  Scenario: An org that turns Grok's direct path off refuses the key
    Given an organisation whose platform policy for "grok" disallows direct OTLP
    When the CLI asks for a personal ingest key for "grok_cli"
    Then the request is refused naming the policy

  @unit
  Scenario: The billable lookup for a Grok session asks with the catalogue slug
    Given a Grok session ingested under a "grok_cli" key
    When pull-request usage asks whether the session's source is billable
    Then it asks for the catalogue slug "grok", not the key's source type

Rule: The receiver keeps the event name Grok sends in its own field

  # Grok 1.0.70 names events only in LogRecord field 12, with no body and no
  # event.name attribute; the pinned decoder predates that field.
  @unit
  Scenario: A protobuf log record named only in its event_name field keeps that name
    Given a protobuf logs export whose records carry "grok_code.user_prompt" only in event_name
    When the receiver parses it
    Then each record's eventName is the name it carried, in wire order

  @unit
  Scenario: A JSON log record keeps the eventName it carries
    Given a JSON logs export whose record has eventName "grok_code.session_start"
    When the receiver parses it
    Then the record's eventName is "grok_code.session_start"

Rule: Grok's fixed resource is enough to recognise it

  @unit
  Scenario: A record whose service is grok-cli is recognised as Grok
    Given a log record with service.name "grok-cli" and scope "ai.xai.grok_code"
    When the agent behind it is detected
    Then it is detected as grok

  @unit
  Scenario: A record carrying only Grok's event prefix is still recognised
    Given a log record named "grok_code.api_request" whose service and scope are empty
    When the agent behind it is detected
    Then it is detected as grok

  # "grok" is not a substring of any other registered agent's service or
  # scope, but an xAI model name ("grok-4.7") rides api_request records of
  # OTHER agents that call xAI. Detection must never read the model name.
  @unit
  Scenario: A Claude Code record that called a Grok model stays Claude Code's
    Given a claude_code.api_request record whose model is "grok-4.7"
    When the agent behind it is detected
    Then it is detected as claude_code

  @unit
  Scenario: Wrapper resource attributes Grok drops are not relied on
    Given Grok exported its records under its own fixed resource
    And no wrapper resource attribute is present on them
    When the records are received under the grok_cli key
    Then they are attributed and recognised from the key alone

Rule: Logs-only sessions group under a synthesized trace

  # Grok's log records carry no trace or span id, the same as Claude Code's.
  # Claude's synthesis keys a turn on session.id and prompt.id and Grok carries
  # both under the same names, but today synthesis runs only for Claude's scope
  # and Codex's prefix: a Grok record gets correlation source "none". Grok
  # joins Claude's branch (scope `ai.xai.grok_code`) and the log provider kind
  # enum gains "grok" (modules/log/contract/src/log-record.ts and its copy in
  # modules/trace/contract/src/features/span/trace-log-contribution.ts).

  @unit
  Scenario: Every record of one Grok turn groups under one synthesized trace id
    Given the user_prompt, api_request, tool_result and assistant_response records of one Grok turn
    And none of them carries a trace id
    When their correlation is synthesized
    Then all of them share one trace id derived from the session id and prompt id
    And each has a distinct span id
    And each is marked as synthesized for Grok, not for Claude

  @unit
  Scenario: A keyless Grok record is not given a trace of its own
    Given a grok_code.mcp_server_connection record with no session.id
    When its correlation is synthesized
    Then it gets no synthesized trace id

Rule: Content is redacted on the way in

  # Grok sends prompt text, assistant text, tool parameters, tool output and
  # absolute home paths when the four OTEL_LOG_* gates are on, which the
  # wrapper turns on (capture everything, ADR-039).

  @unit @unimplemented
  Scenario: PII in a Grok prompt is redacted before it is stored
    Given a grok_code.user_prompt record whose prompt holds an email address
    When it is ingested
    Then the stored prompt has the address redacted

  @unit
  Scenario: The user's email Grok stamps on every record is never stored as a session field
    Given Grok records carrying user.email
    When the session is folded
    Then the session row carries no email address
