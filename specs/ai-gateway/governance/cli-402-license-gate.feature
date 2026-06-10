Feature: CLI 402 license gate on /api/auth/cli/governance/*
  As an enterprise admin who runs `langwatch ingest list` / `langwatch
  governance status` from a CLI on a non-enterprise org
  I want a clear 402 Payment Required response (RFC 7231 §6.5.2) with the
  upgrade URL inline
  So that the CLI can render an actionable upsell instead of a cryptic
  "500 Internal Server Error" or a generic "feature not available" toast

  Mirrors the tRPC `requireEnterprisePlan` middleware (Phase 4b-5,
  `f8eec569b`) and the UI `<EnterpriseLockedSurface>` wrap (Phase 4b-1+4b-2,
  `2c3435e64`) — same intent, REST 402 envelope instead of TRPCError
  FORBIDDEN or a React upsell card.

  Background:
    Given organization "acme" exists on a FREE plan (non-enterprise)
    And organization "globex" exists on an ENTERPRISE plan
    And alice is an org ADMIN of "acme" with a valid CLI device-flow access token
    And bob is an org ADMIN of "globex" with a valid CLI device-flow access token

  Scenario: GET /api/auth/cli/governance/status returns 402 for non-enterprise
    When alice's CLI calls `GET /api/auth/cli/governance/status`
    Then the response status is 402
    And the response body is:
      """
      {
        "error": "payment_required",
        "error_description": "Ingestion sources require an Enterprise plan",
        "upgrade_url": "https://app.langwatch.ai/settings/subscription"
      }
      """

  Scenario: GET /api/auth/cli/governance/ingest/sources returns 402 for non-enterprise
    When alice's CLI calls `GET /api/auth/cli/governance/ingest/sources`
    Then the response status is 402
    And the response body has `error: "payment_required"`
    And the response body has `upgrade_url` pointing at `/settings/subscription`

  Scenario: GET /api/auth/cli/governance/ingest/sources/:id/events returns 402 for non-enterprise
    Given an IngestionSource "src-123" exists in acme
    When alice's CLI calls `GET /api/auth/cli/governance/ingest/sources/src-123/events`
    Then the response status is 402
    And the response body has `error: "payment_required"`

  Scenario: GET /api/auth/cli/governance/ingest/sources/:id/health returns 402 for non-enterprise
    Given an IngestionSource "src-123" exists in acme
    When alice's CLI calls `GET /api/auth/cli/governance/ingest/sources/src-123/health`
    Then the response status is 402
    And the response body has `error: "payment_required"`

  Scenario: 401 fires before 402 — unauthenticated requests don't leak plan info
    When an anonymous CLI calls `GET /api/auth/cli/governance/status` with no Authorization header
    Then the response status is 401
    And the response body has `error: "unauthorized"`
    And the response body does NOT contain `payment_required`

  Scenario: Enterprise org passes the gate cleanly
    When bob's CLI calls `GET /api/auth/cli/governance/status`
    Then the response status is 200
    And the response body has the org's setup-state OR-of-flags shape

  Scenario: CLI surfaces the upgrade URL in stderr on 402
    Given alice's CLI receives the 402 envelope from any governance endpoint
    When the CLI handles the GovernanceCliError
    Then stderr contains the human-readable description "Ingestion sources require an Enterprise plan"
    And stderr contains the upgrade URL on a separate line for click-targeting
