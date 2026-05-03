Feature: AI Gateway Governance — Personal budget exceeded surfaces (CLI + dashboard)
  As an enterprise developer with a per-user spend cap
  I want a clear, actionable message at every surface (CLI, dashboard, terminal
  banner) when I hit my budget — and a path to request more
  So that I'm never confused about why my AI tool stopped working

  Per gateway.md "screen 8":
      The CLI surfaces "Budget limit reached" with a clear amount + admin email
      + a `langwatch request-increase` command.
  The dashboard surfaces a red banner at the top of /me with the same info
  and a primary CTA to request an increase.
  The gateway returns a structured 402 (Payment Required) so any consuming
  CLI/SDK can render its own message.

  Background:
    Given user "jane@acme.com" has a USD 500/month personal budget
    And jane has spent USD 500.00 in the current month
    And the gateway budget-fold from ClickHouse confirms the spend total
    And the gateway's `/budget/check` endpoint will return `blocked_by: "personal"`

  # ---------------------------------------------------------------------------
  # Gateway response shape
  # ---------------------------------------------------------------------------

  @bdd @gateway @budget-exceeded @api
  Scenario: Gateway returns 402 with structured error when budget is exceeded
    When jane's CLI sends a request via her personal VK
    Then the gateway responds with HTTP 402
    And the response body matches this shape:
      """
      {
        "error": {
          "type": "budget_exceeded",
          "scope": "user",
          "limit_usd": "500.00",
          "spent_usd": "500.00",
          "period": "month",
          "request_increase_url": "https://app.langwatch.example.com/me/budget/request",
          "admin_email": "platform-team@acme.com"
        }
      }
      """
    And the response includes header `Retry-After: <seconds-until-month-rollover>`
    And the response includes header `X-LangWatch-Budget-Blocked-By: user`

  # ---------------------------------------------------------------------------
  # CLI rendering
  # ---------------------------------------------------------------------------

  @bdd @cli @budget-exceeded @ux
  Scenario: `langwatch claude` renders a clear budget message and exits non-zero
    When jane runs `langwatch claude`
    And the gateway returns the 402 budget_exceeded payload above
    Then the CLI prints (no ANSI noise into pipes):
      """
      ⚠  Budget limit reached

         You've used $500.00 of your $500.00 monthly budget.
         To continue, ask your team admin to raise your limit.

         Admin: platform-team@acme.com

         Need urgent access? Run:
           langwatch request-increase
      """
    And the CLI exits with status 2 (configuration / quota error, not 1 generic)
    And no Claude/Codex/Cursor process is exec'd

  @bdd @cli @budget-exceeded @ux
  Scenario: `langwatch claude` lets a passthrough error reach the underlying tool when not personal-budget related
    Given the gateway returns a different 4xx (e.g. 429 rate-limit, 403 model-not-allowed)
    When jane runs `langwatch claude`
    Then the CLI does NOT pre-empt the call
    And it exec's claude with the env vars
    And claude renders its own error message based on the upstream response

  @bdd @cli @budget-exceeded @request
  Scenario: `langwatch request-increase` opens the request page in the browser
    When jane runs `langwatch request-increase`
    Then the CLI opens the URL printed by the gateway in `request_increase_url`
    And the URL includes the user's id and current limit/spend as query params (signed/HMAC'd to prevent tampering)

  # ---------------------------------------------------------------------------
  # Dashboard banner
  # ---------------------------------------------------------------------------

  @bdd @ui @budget-exceeded @banner
  Scenario: /me dashboard shows a red banner at the top when budget is exceeded
    Given jane's personal budget is exceeded
    When she navigates to "/me"
    Then a Chakra `colorPalette="red"` banner is rendered above the cards
    And the banner reads "Budget limit reached — $500.00 of $500.00 spent this month."
    And the banner has a primary button "Request more"
    And the banner has a secondary link "Email your admin (platform-team@acme.com)"
    And clicking "Request more" opens "/me/budget/request"

  @bdd @ui @budget-exceeded @cards
  Scenario: The "Spent this month" card turns red and shows "Limit reached"
    Given jane's personal budget is exceeded
    When she navigates to "/me"
    Then the "Spent this month" card text colour is `red.600` (or themed equivalent)
    And the card's "of $X budget" subline is replaced with "Limit reached"
    And the card carries an inline icon `Warning`

  # ---------------------------------------------------------------------------
  # 80% threshold (soft warning)
  # ---------------------------------------------------------------------------

  @bdd @ui @budget-exceeded @warn
  Scenario: 80% threshold renders a yellow banner instead of blocking
    Given jane has spent USD 410 of her USD 500/month budget (82%)
    When she navigates to "/me"
    Then a yellow `colorPalette="yellow"` banner reads "You've used 82% of your monthly budget."
    And requests are NOT blocked at the gateway
    And the card shows "$410 of $500" without colour change beyond the banner

  @bdd @cli @budget-exceeded @warn
  Scenario: 80% threshold injects a single-line warning at the top of `langwatch claude` output
    Given jane has spent USD 410 of her USD 500/month budget (82%)
    When she runs `langwatch claude`
    Then before exec'ing claude the CLI prints to stderr:
      """
      ⚠  langwatch: You've used 82% of your $500 monthly budget.
      """
    And then exec's claude normally
    And subsequent invocations within 6 hours suppress this banner (rate-limited via local timestamp file)

  # ---------------------------------------------------------------------------
  # Hierarchy precedence
  # ---------------------------------------------------------------------------

  @bdd @gateway @budget-exceeded @hierarchy
  Scenario: When ANY scope budget is exceeded, the request is blocked
    Given jane's personal budget is NOT exceeded
    But the team "Sales Engineering" budget IS exceeded
    And jane is on the Sales Engineering team and her request attribution rolls up
    When jane sends a request via her personal VK while attributed to that team
    Then the gateway returns 402 with `scope: "team"` (not `user`)
    And the CLI prints "Budget limit reached at the team level (Sales Engineering)..."
    And the request_increase_url points at the team admin / team budget request page
