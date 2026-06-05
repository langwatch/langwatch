Feature: Coding-assistant Path B mints a template-free ingestion binding
  The unified coding assistants (claude, codex, gemini, opencode) are NOT
  ingestion templates (see ingestion-templates-catalog.feature). The platform
  owns their setup end to end: `langwatch <tool>` configures the tool and the
  receiver converts their OTLP model-call logs into canonical gen_ai spans.

  So when `langwatch <tool>` resolves to Path B (ingestion / OTLP direct), it
  mints a UserIngestionBinding WITHOUT a catalog IngestionTemplate. The binding
  is identified by `sourceType` (the tool's canonical slug) instead of a
  template row; `templateId` is null for these bindings.

  Why this matters:
    The earlier design keyed the binding on an IngestionTemplate row and on the
    global (userId, templateId) unique. Removing the coding-assistant template
    rows would have 404'd `langwatch claude`, and the global unique 409'd
    multi-org users (and could rotate a binding across orgs). The binding is now
    template-free and keyed on (personalProjectId, sourceType): per-org by
    construction, and a repeat install rotates the token in place.

  Background:
    Given the user has signed in with `langwatch login`
    And the user has a personal project in the active organization

  Rule: Path B for a unified coding assistant mints a template-free binding

    Scenario: A subscription-only claude run mints Path B without a template
      Given the user has no virtual key configured for "claude"
      And the platform policy for "claude" allows OTLP direct
      When the user runs `langwatch claude`
      Then the wrapper resolves to ingestion mode
      And it installs a binding keyed by sourceType "claude_code"
      And it does NOT look up an ingestion template
      And it sets the tool's OTLP exporter to the personal OTLP endpoint
      And the OTLP Authorization header carries the issued binding token

    Scenario Outline: Every unified coding assistant mints the same way
      Given the user has no virtual key configured for "<tool>"
      And the platform policy for "<tool>" allows OTLP direct
      When the user runs `langwatch <tool>`
      Then the wrapper installs a binding keyed by sourceType "<sourceType>"
      And no ingestion template lookup happens

      Examples:
        | tool     | sourceType |
        | claude   | claude_code |
        | codex    | codex       |
        | gemini   | gemini      |
        | opencode | opencode    |

  Rule: the install is idempotent per (personal project, source)

    Scenario: A repeat run rotates the token in place instead of 409'ing
      Given a "claude_code" binding already exists for the user's personal project
      When the user runs `langwatch claude` again
      Then the server rotates the existing binding's token in place
      And it does not raise a binding-already-exists error
      And the wrapper hands the freshly rotated token to the tool

    Scenario: The same tool in two orgs gets two independent bindings
      Given the user belongs to org "acme" and org "beta-corp"
      And the user has a personal project in each org
      When the user runs `langwatch claude` while active in "acme"
      And later runs `langwatch claude` while active in "beta-corp"
      Then each org's personal project has its own "claude_code" binding
      And rotating one does not touch the other

  Rule: the platform policy still gates the OTLP-direct path

    Scenario: OTLP direct disabled with a virtual key present falls back to gateway
      Given the platform policy for "claude" disables OTLP direct
      And the user has a virtual key configured for "claude"
      When the user runs `langwatch claude`
      Then the wrapper resolves to gateway mode
      And it does not mint an ingestion binding

    Scenario: Both paths disabled refuses to run
      Given the platform policy for "claude" disables both gateway and OTLP direct
      When the user runs `langwatch claude`
      Then the wrapper fails with a tool-disabled error
      And the message tells the user to ask their org admin to enable a path

  Rule: receiver provenance survives the missing template

    Scenario: A template-free binding still stamps langwatch.source
      Given a trace lands on the personal OTLP endpoint via a "claude_code" binding
      When the receiver stamps binding provenance
      Then langwatch.source is stamped from the binding's sourceType
      And langwatch.template.id is omitted because there is no template
      And langwatch.origin and langwatch.organization_id are still stamped
