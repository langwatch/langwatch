Feature: Internal feature flag system for system-level kill switches
  As a platform operator running LangWatch
  I want backend kill switches and pipeline toggles served from our own
  postgres-backed flag store, never from PostHog
  So that hot-path code does not flood our PostHog billing with per-event
  flag checks and so that operators can flip kill switches in seconds
  without a redeploy, on both SaaS and self-hosted installs

  # ===========================================================================
  # 2026-05 PostHog billing spike — context
  # ===========================================================================
  # Around 2026-05-13 PostHog "Feature Flag Calls by Library" jumped from
  # ~8k/day to ~50k/day. Root cause was event-sourcing's per-component kill
  # switch wrapper (`es-<aggregate>-<component>-<name>-killswitch`) being
  # checked per (tenant × component × event) against PostHog whenever the
  # local-evaluation cache key was unique. Those flags are not product
  # toggles — operators want them in our own DB so they cost nothing
  # external, can be flipped instantly via the Ops UI, and exist on
  # self-hosted installs that may not have PostHog wired at all.
  #
  # Resolution: a flag registry split by SCOPE.
  #   - SYSTEM scope: never consults PostHog. Resolved from
  #     env → DB → registry default. Hot-path safe.
  #   - PRODUCT scope: keeps PostHog (A/B testing, user targeting) with
  #     env override on top and a DB fallback so self-hosted installs
  #     without PostHog can still toggle product features.

  Background:
    Given the application registers every flag in a single in-code registry
    And each registry entry declares whether the flag is SYSTEM or PRODUCT scope
    And system-scoped flags are reserved for backend kill switches and
        pipeline toggles
    And product-scoped flags are reserved for UI features and A/B tests
    And the registry default for a flag is used when no override is found

  Rule: SYSTEM flags never reach PostHog

    Scenario: hot-path event-sourcing kill switch resolves without a PostHog call
      Given the registry has a SYSTEM-scoped flag for the trace-processing
            projection kill switch
      And no environment variable forces the flag on or off
      And no row exists for the flag in the postgres flag store
      When the trace-processing pipeline checks the kill switch for ten
           thousand events
      Then the resolved value matches the registry default for every check
      And no request is made to PostHog
      And the per-pod cache absorbs the bulk of those checks

    Scenario: SYSTEM flag flipped on in postgres takes effect cluster-wide within seconds
      Given an operator opens the Ops Feature Flags page
      And the operator toggles a SYSTEM kill switch from disabled to enabled
      When the change is saved to postgres
      Then every running pod observes the new value within one cache window
      And no PostHog call is made to learn about the change

    Scenario: SYSTEM flag with a per-flag env override beats the postgres value
      Given the postgres flag store has the flag set to disabled
      And the per-flag env override forces the flag enabled for this pod
      When code checks the flag
      Then the flag resolves enabled for this pod regardless of postgres

    Scenario: family-prefixed kill switch resolves SYSTEM without an explicit registry entry
      Given the registry declares the event-sourcing kill switch family
            covering keys that start with the family prefix and end with
            the kill-switch suffix
      And no explicit registry entry exists for one specific generated
          kill switch key in that family
      When code checks that generated kill switch key
      Then the flag resolves as SYSTEM scope inherited from the family
      And no PostHog call is made

    Scenario: legacy env variable name keeps working after a flag is renamed into the registry
      Given a SYSTEM flag whose registry definition declares the older
            uppercase env variable name that was used before the flag
            moved into the registry
      And the legacy env variable is set to enable the flag
      When code checks the new registry key
      Then the flag resolves enabled from the legacy env override

  Rule: PRODUCT flags keep PostHog with a postgres fallback

    Scenario: PRODUCT flag with PostHog reachable consults PostHog for user targeting
      Given the registry has a PRODUCT-scoped UI flag
      And PostHog is configured and reachable
      And the postgres flag store has no row or rule matching the calling context
      When the flag is checked for a known user
      Then PostHog evaluates the flag using the user's properties
      And the postgres store is not used as the source of truth for that result

    Scenario: PRODUCT flag falls back to postgres when PostHog is not configured
      Given the installation has no PostHog key configured
      And the postgres flag store has the PRODUCT flag set to enabled
      When the flag is checked
      Then the flag resolves enabled from the postgres value
      And no PostHog call is attempted

    Scenario: PRODUCT flag env override beats both PostHog and postgres
      Given PostHog would return disabled for this flag and user
      And the postgres flag store has the flag set to disabled
      And the per-flag env override forces the flag enabled
      When the flag is checked
      Then the flag resolves enabled

  Rule: Postgres targeting rules win over PostHog

    Scenario: org-scoped postgres rule enables a PRODUCT flag without touching PostHog
      Given the postgres flag store has a row for the PRODUCT flag with
            a targeting rule matching the calling organization and enabled true
      And PostHog would return disabled for this flag and user
      When the flag is checked with that organization in context
      Then the flag resolves enabled from the postgres rule
      And no PostHog call is attempted

    Scenario: project-scoped postgres rule overrides the row-level default
      Given the postgres flag store has a row for the PRODUCT flag with
            a row-level enabled value of false
      And the row carries a targeting rule that matches the calling project
            with enabled true
      When the flag is checked with that project in context
      Then the flag resolves enabled from the targeting rule

    Scenario: rule order wins on the first match
      Given the postgres flag store has a row whose first rule matches the
            calling organization with enabled true
      And the row's second rule matches the same organization with enabled false
      When the flag is checked with that organization in context
      Then the flag resolves enabled because the first matching rule wins

    Scenario: rules that do not match fall through to the row-level enabled value
      Given the postgres flag store has a row whose only rule matches a
            different organization than the calling one
      And the row-level enabled value is false
      When the flag is checked
      Then the flag resolves disabled from the row-level enabled value
      And PostHog is not consulted because the postgres row was present

  Rule: Operators manage flags from the Ops Feature Flags page

    Scenario: Ops Feature Flags page lists every registered flag with its current resolved value
      Given an operator with ops:view permission opens /ops/feature-flags
      Then the page lists every flag declared in the registry
      And each row shows the flag's scope, description, registry default,
          postgres value, and effective resolved value
      And rows whose effective value comes from an env override show an
          "env override" badge so operators do not get confused by an
          unresponsive toggle

    Scenario: Operator without ops:manage permission cannot toggle flags
      Given an operator with only ops:view permission opens the page
      When the operator attempts to toggle a flag
      Then the toggle is disabled in the UI
      And the API rejects any toggle attempt with a permission error

    Scenario: Operator with ops:manage permission toggles a SYSTEM flag on
      Given an operator with ops:manage permission opens the page
      When the operator toggles a SYSTEM flag from disabled to enabled
      Then the postgres flag store is updated
      And the change is broadcast to every pod via the shared cache invalidation channel
      And the page reflects the new effective value without a manual refresh

    Scenario: Operator clears a SYSTEM flag override to restore the registry default
      Given the postgres flag store has a row for a SYSTEM flag setting it
            opposite to its registry default
      When the operator clicks "clear" next to the flag on the Ops UI
      Then the postgres row is removed
      And the flag resolves to its registry default again
      And the page row shows source "registry default" and last edit "never"

    Scenario: Ops page warns when a PRODUCT flag is being managed on a SaaS install
      Given the installation is running in SaaS mode with PostHog enabled
      And the operator focuses a PRODUCT-scoped flag row
      Then the page surfaces a note that PRODUCT flags should normally be
          managed in PostHog so user targeting and A/B test rules apply
      And the operator can still set a postgres override for emergency use

  Rule: Self-hosted parity

    Scenario: Self-hosted install with no PostHog can still flip kill switches
      Given the installation is self-hosted with no PostHog configured
      When an operator toggles a SYSTEM kill switch from the Ops UI
      Then the change persists in postgres
      And every pod observes the new value
      And no PostHog call is ever attempted at any point in the chain
