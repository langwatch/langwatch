Feature: Per-tool path policy — an org admin enables or disables each langwatch <tool> path
  Each unified coding assistant the CLI wraps (claude, codex, gemini, opencode,
  cursor) can route two ways:

    - Path A (gateway / virtual key): the tool talks to the LangWatch gateway
      through the user's personal virtual key. Controlled by `allowVk`.
    - Path B (direct OTLP ingestion): the tool exports telemetry straight to the
      personal OTLP endpoint with an ingestion binding token. Controlled by
      `allowOtelDirect`.

  An org admin governs which paths are available per tool from the tool-catalog
  settings page, so the CLI only offers the paths the org permits. The policy is
  per (organization, tool): one org can force every developer onto the gateway
  (disable OTLP direct) while another allows both.

  The defaults preserve today's behavior with no admin action: claude, codex,
  gemini, and opencode allow both paths; cursor is GUI-only so it allows the
  gateway path but not OTLP direct. A tool with no stored row resolves to these
  hardcoded defaults, so the policy is purely additive — disabling a path is an
  explicit admin choice.

  The CLI learns the policy at login: `langwatch login` caches the per-tool
  policy map in its config, and `langwatch <tool>` gates path selection on the
  cached policy. An offline or legacy CLI with no cached policy falls back to the
  same hardcoded defaults, so it never gets stuck.

  Pairs with:
    - specs/ai-governance/cli-wrappers/wrap-login-routing.feature (path selection)
    - specs/ai-governance/cli-wrappers/ingestion-personal-otlp.feature (Path B mint)

  Implementation lives under:
    - langwatch/ee/governance/services/platformToolPolicy.service.ts   (resolve + upsert)
    - langwatch/ee/governance/routers/platformToolPolicy.ts            (tRPC list/update)
    - langwatch/ee/governance/services/cliBootstrap.service.ts         (login payload)
    - typescript-sdk/src/cli/utils/governance/platform-tool-policy.ts  (CLI resolver)

  Background:
    Given the user is signed in as an org admin of "acme-corp"
    And the governance preview flag is enabled for acme-corp

  Rule: defaults preserve current behavior with no stored rows

    Scenario Outline: A tool with no stored policy resolves to its hardcoded default
      Given "acme-corp" has no stored policy row for "<tool>"
      When the admin loads the per-tool path policy
      Then "<tool>" reports allowVk "<allowVk>" and allowOtelDirect "<allowOtelDirect>"

      Examples:
        | tool     | allowVk | allowOtelDirect |
        | claude   | true    | true            |
        | codex    | true    | true            |
        | gemini   | true    | true            |
        | opencode | true    | true            |
        | cursor   | true    | false           |

  Rule: an admin can disable a path per tool

    Scenario: Disabling OTLP direct for claude stores an override
      Given "acme-corp" has no stored policy row for "claude"
      When the admin disables OTLP direct for "claude"
      Then a policy row for ("acme-corp", "claude") records allowOtelDirect false
      And allowVk stays true
      And the change is recorded in the audit log

    Scenario: Re-enabling a path updates the same row in place
      Given "acme-corp" has a policy row for "claude" with allowOtelDirect false
      When the admin re-enables OTLP direct for "claude"
      Then the same policy row now records allowOtelDirect true
      And no second row is created for ("acme-corp", "claude")

    Scenario: One org's override does not affect another org
      Given org "beta-corp" also exists with no stored policy for "claude"
      When the admin of "acme-corp" disables OTLP direct for "claude"
      Then "beta-corp" still resolves "claude" to allowOtelDirect true

  Rule: only org admins can change the policy

    Scenario: A non-admin member cannot update the policy
      Given the user is a plain member of "acme-corp"
      When the user attempts to disable OTLP direct for "claude"
      Then the request is rejected for missing the governance manage permission
      And no policy row is written

  Rule: the CLI gates path selection on the resolved policy

    Scenario: Login caches the per-tool policy map
      Given "acme-corp" has a policy row for "claude" with allowOtelDirect false
      When the user completes `langwatch login`
      Then the CLI config caches a tool-policy map
      And the cached entry for "claude" has allowOtelDirect false

    Scenario: OTLP direct disabled with a virtual key present forces the gateway path
      Given the cached policy for "claude" has allowVk true and allowOtelDirect false
      And the user has a personal virtual key for "claude"
      When the user runs `langwatch claude`
      Then the wrapper resolves to gateway mode
      And it does not offer the ingestion path

    Scenario: Both paths disabled refuses to run with an admin hint
      Given the cached policy for "claude" has allowVk false and allowOtelDirect false
      When the user runs `langwatch claude`
      Then the wrapper fails with a tool-disabled error
      And the message tells the user to ask their org admin to enable a path

    Scenario: A CLI with no cached policy falls back to hardcoded defaults
      Given the CLI config has no tool-policy map
      When the user runs `langwatch claude`
      Then the wrapper resolves "claude" to allowVk true and allowOtelDirect true
      And both paths remain available
