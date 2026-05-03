Feature: AI Gateway Governance — CLI ↔ Dashboard deep-links + request-increase
  As an enterprise developer using the langwatch CLI day-to-day
  I want to jump from a terminal transcript to the matching trace
  in my web dashboard, and to a signed budget-increase request
  page when the gateway tells me I've hit a limit
  So that I never have to copy/paste IDs across surfaces and
  my admin sees the right context when I ask for more budget

  This feature is the bridge between the screen-5 (terminal use)
  and screen-6 (web dashboard) flows from gateway.md, plus the
  Screen-8 "Need urgent access?" tail of budget-exceeded.feature.
  CLI ↔ Web bridge is what stops devs from feeling like they live
  in two disconnected products.

  Background:
    Given the langwatch CLI is installed
    And user "jane@acme.com" is logged in (config at ~/.langwatch/config.json)
    And her config has:
      | gateway_url       | http://gateway.langwatch.example.com  |
      | control_plane_url | http://app.langwatch.example.com      |

  # ---------------------------------------------------------------------------
  # `langwatch dashboard` — default (no flags)
  # ---------------------------------------------------------------------------

  @bdd @cli @dashboard
  Scenario: Default dashboard opens the user's /me page
    When jane runs "langwatch dashboard"
    Then the CLI prints "Opening http://app.langwatch.example.com/me"
    And the CLI invokes the OS default browser launcher with that URL
    And the CLI exits with status 0

  @bdd @cli @dashboard @auth
  Scenario: Dashboard refuses when not logged in
    Given jane is NOT logged in (config absent)
    When she runs "langwatch dashboard"
    Then the CLI exits non-zero
    And stderr contains "not logged in — run `langwatch login`"
    And the CLI does NOT attempt to open a browser

  # ---------------------------------------------------------------------------
  # `langwatch dashboard --trace <id>` — Screen-5 → Screen-6 bridge
  # ---------------------------------------------------------------------------

  @bdd @cli @dashboard @deep-link
  Scenario: --trace deep-links to the per-trace view
    Given a trace with id "tr_01HZK9ABCD" exists in jane's personal project
    When she runs "langwatch dashboard --trace tr_01HZK9ABCD"
    Then the CLI prints "Opening http://app.langwatch.example.com/me/traces/tr_01HZK9ABCD"
    And the CLI invokes the OS default browser launcher with that URL

  @bdd @cli @dashboard @deep-link @encoding
  Scenario: --trace URL-encodes the id so special characters are safe
    Given the CLI receives the flag "--trace some/weird/id with spaces"
    When the URL is constructed
    Then the path segment is URL-encoded: "some%2Fweird%2Fid%20with%20spaces"
    And no shell-injection or path-escape leaks into the launcher invocation

  @bdd @cli @dashboard @deep-link @404
  Scenario: --trace with an unknown id still opens the URL (server renders 404)
    Given trace "tr_does_not_exist" is not in jane's workspace
    When she runs "langwatch dashboard --trace tr_does_not_exist"
    Then the CLI's job ends at opening the URL — exit 0
    And the dashboard surface is responsible for the not-found page
    # The CLI doesn't pre-validate trace existence: that would require an
    # extra round-trip + auth dance for zero UX benefit. The dashboard
    # already has a polished 404 view.

  # ---------------------------------------------------------------------------
  # `langwatch request-increase` — Screen-8 tail
  # ---------------------------------------------------------------------------

  @bdd @cli @request-increase @signed-url
  Scenario: request-increase opens the gateway-issued signed URL when cached
    Given a recent 402 budget_exceeded response wrote
      """
      last_request_increase_url:
        https://app.langwatch.example.com/me/budget/request?u=jane&l=500&s=500&hmac=abc
      """
      to ~/.langwatch/config.json
    When jane runs "langwatch request-increase"
    Then the CLI prints "Opening https://app.langwatch.example.com/me/budget/request?u=jane&l=500&s=500&hmac=abc"
    And the CLI invokes the OS default browser launcher with that URL
    # The signed URL carries user_id + limit + spent params (HMAC'd) so
    # the admin sees the request with full context, not a generic page.

  @bdd @cli @request-increase @fallback
  Scenario: request-increase falls back to the static page when no signed URL is cached
    Given ~/.langwatch/config.json has no last_request_increase_url
    When jane runs "langwatch request-increase"
    Then the CLI prints "Opening http://app.langwatch.example.com/me/budget/request"
    And the CLI invokes the OS default browser launcher with that URL

  @bdd @cli @request-increase @auth
  Scenario: request-increase refuses when not logged in
    Given jane is NOT logged in (config absent)
    When she runs "langwatch request-increase"
    Then the CLI exits non-zero
    And stderr contains "not logged in"

  @bdd @cli @request-increase @persist
  Scenario: A 402 from the gateway during a wrapped command persists the signed URL
    Given the gateway is configured to return 402 budget_exceeded for jane's next request
    When she runs "langwatch claude" (which calls CheckBudget before exec)
    Then the CLI prints the spec-canonical Screen-8 box
    And ~/.langwatch/config.json has its `last_request_increase_url` field set to
        the gateway-issued signed URL
    And the file's mode remains 0600 (no perm regression on save)
    And a follow-up "langwatch request-increase" opens that URL

  # ---------------------------------------------------------------------------
  # Browser-launcher selection (shared with login flow)
  # ---------------------------------------------------------------------------

  @bdd @cli @dashboard @browser
  Scenario: LANGWATCH_BROWSER override is honored for dashboard + request-increase
    Given env var LANGWATCH_BROWSER="google-chrome"
    When jane runs "langwatch dashboard --trace tr_x"
    Then on macOS: `open -a 'Google Chrome' <url>` is invoked
    And on Linux: `google-chrome <url>` is invoked
    And on Windows: `cmd /c start "" chrome <url>` is invoked
    # Same env-var-driven launcher selection as `langwatch login` —
    # documented in cli-reference.mdx#install.

  @bdd @cli @dashboard @browser
  Scenario: LANGWATCH_BROWSER=none suppresses launcher (still prints URL)
    Given env var LANGWATCH_BROWSER="none"
    When jane runs "langwatch dashboard --trace tr_x"
    Then the CLI prints "Opening http://app.langwatch.example.com/me/traces/tr_x"
    And NO browser process is spawned
    And exit status is 0
    # Useful for headless CI / SSH-without-X / programmatic shell wrappers
    # that just want the URL printed.
