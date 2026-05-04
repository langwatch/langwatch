Feature: Budget-increase request — `/me/budget/request` page + admin notification
  As a developer who hit a personal/team budget cap
  I want one click to ask my org admin to raise it (or extend the period)
  So that I'm not stuck typing a Slack message and copy-pasting numbers — the
  context (scope, limit_usd, spent_usd, period) carries through automatically.

  Wires together two surfaces:
    1. CLI: `langwatch request-increase` → opens the signed URL the gateway
       returned in the 402 (or falls back to the static `/me/budget/request`).
    2. UI:  `/me/budget/request?scope=…&scope_id=…&limit_usd=…&spent_usd=…`
       reads those query params, renders a real page, and on submit calls
       `api.user.requestBudgetIncrease` which emails the org admin.

  Background:
    Given the user is logged in to LangWatch
    And the user's org has at least one ADMIN role-member with an email
    And email infrastructure (SES or SendGrid) is configured

  # ────────────────────────────────────────────────────────────────────
  # Page renders + carries query-param context
  # ────────────────────────────────────────────────────────────────────
  Scenario: Page reads scope context from query params
    When the user navigates to
      `/me/budget/request?scope=user&scope_id=usr_x&limit_usd=10.00&spent_usd=10.50&period=monthly`
    Then the page renders a "Request budget increase" header
    And the page renders a context block showing
      | field          | value           |
      | Scope          | user            |
      | Period         | monthly         |
      | Spent so far   | $10.50          |
      | Current limit  | $10.00          |
    And the page renders the resolved org admin email as the destination ("To: admin@acme.test")
    And the page renders a single primary "Send request" button

  Scenario: Page handles missing/invalid query params gracefully
    When the user navigates to `/me/budget/request` (no query params)
    Then the page renders the form with the context block omitted
    And the user can still type a free-form message and submit

  # ────────────────────────────────────────────────────────────────────
  # Submit → tRPC mutation → admin email
  # ────────────────────────────────────────────────────────────────────
  Scenario: Submit emails the org admin with the budget context
    Given the page is rendered with valid scope context
    When the user clicks "Send request" (optional message left blank)
    Then `api.user.requestBudgetIncrease` is invoked with
      | input            |
      | scope            |
      | scopeId          |
      | limitUsd         |
      | spentUsd         |
      | period           |
      | message          |
    And the mutation resolves the org's first ADMIN by email
    And `sendEmail` is invoked once with
      | to       | <admin email>                                                    |
      | subject  | Budget increase request from <user email>                        |
      | bodyHtml | contains user/scope/limit/spent + "Approve via LangWatch" link   |
    And the page transitions to a "Sent ✓" confirmation state
    And the user's free-form message (if any) is included in the email body verbatim

  Scenario: Submit with custom message
    Given the page is rendered with valid scope context
    When the user types "Need it for the demo on Friday — usually under limit"
      into the message textarea
    And clicks "Send request"
    Then the email body contains the user's message verbatim under a
      "Message from the user" section

  # ────────────────────────────────────────────────────────────────────
  # Edge cases — degrade honestly, never lie
  # ────────────────────────────────────────────────────────────────────
  Scenario: No org admin to email
    Given the user's org has zero ADMIN role-members
    When the user clicks "Send request"
    Then the mutation throws an INTERNAL_SERVER_ERROR / NO_ADMIN_FOUND
    And the page renders an actionable error
      "No organization admin is configured — contact LangWatch support."
    And no email is sent

  Scenario: Email service is unavailable (SES/SendGrid down)
    Given the user clicks "Send request"
    When `sendEmail` throws
    Then the mutation re-throws as INTERNAL_SERVER_ERROR
    And the page renders "Could not send request — try again or contact your admin directly: admin@acme.test"
    And the error is logged on the server (no PII leak in the response)

  Scenario: User without organization (personal-only / ungoverned)
    Given the user has NO organization membership (org-less personal account)
    When the user navigates to `/me/budget/request`
    Then the page renders a friendly empty-state explaining that budget-increase
      requests only apply to organization-managed accounts
    And no submit button is rendered

  # ────────────────────────────────────────────────────────────────────
  # CLI side — `langwatch request-increase`
  # ────────────────────────────────────────────────────────────────────
  Scenario: `langwatch request-increase` opens the signed URL persisted from a prior 402
    Given a prior wrapper invocation persisted `last_request_increase_url` to
      "http://app.test/me/budget/request?scope=user&scope_id=usr_x&limit_usd=10.00&spent_usd=10.50"
    When the user runs `langwatch request-increase`
    Then the CLI opens that exact URL in the browser
    And exits 0

  Scenario: `langwatch request-increase` falls back to the static page when no prior 402 was seen
    Given `last_request_increase_url` is unset in the persisted config
    When the user runs `langwatch request-increase`
    Then the CLI opens `<control_plane_url>/me/budget/request` in the browser
    And exits 0

  Scenario: `langwatch request-increase` exits 1 if not logged in
    Given the user is NOT logged in
    When the user runs `langwatch request-increase`
    Then the CLI exits 1 with "Not logged in" stderr
    And no browser is opened
