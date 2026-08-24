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
  #
  # ===========================================================================
  # 2026-08 amendment — PostHog left the resolver entirely
  # ===========================================================================
  # PR #7194 deleted the PostHog service and its branch of the resolver, so
  # the split above no longer describes two paths. BOTH scopes now resolve
  #   env override -> force-enable list -> postgres store -> registry default
  # and no flag of either scope consults PostHog. The PRODUCT scenarios below
  # that name PostHog are kept as the record of the 2026-05 design; the
  # scenarios under "Every registered flag resolves from our own store" are
  # the current contract.
  #
  # What scope still means: it is the classification the Ops UI groups and
  # badges by, and it records who owns the lever — SYSTEM meaning the internal
  # flag store is the only administration point. It decides nothing about how
  # a value is fetched, and it does not decide whether targeting applies.

  Background:
    Given the application registers every flag in a single in-code registry
    And each registry entry declares whether the flag is SYSTEM or PRODUCT scope
    And system-scoped flags are reserved for backend kill switches and
        pipeline toggles
    And product-scoped flags are reserved for UI features and A/B tests
    And the registry default for a flag is used when no override is found
    And both scopes resolve through the same order, so scope changes who
        administers a flag and never how its value is found

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

  # Superseded by the 2026-08 amendment: PostHog is no longer consulted
  # for any flag. Retained as the record of the 2026-05 design.
  Rule: PRODUCT flags kept PostHog with a postgres fallback (until 2026-08)

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

  Rule: Postgres targeting rules decide the value

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

  Rule: Every registered flag resolves from our own store, whatever its scope

    Scenario: a SYSTEM flag takes per-organization targeting like any other
      Given the registry has a SYSTEM-scoped flag
      And the postgres flag store has a row for it whose targeting rule
          matches the calling organization with enabled true
      And the row-level enabled value is false
      When the flag is checked with that organization in context
      Then the flag resolves enabled from the targeting rule
      And the result is reached the same way it would be for a PRODUCT flag

    @unit
    Scenario: a flag the web UI can read is registered, so operators keep the lever
      Given a flag key is exposed to the frontend
      Then it resolves to a registry entry, whether SYSTEM or PRODUCT scoped, so
           /ops/feature-flags can list it and target it per organization
      And an unregistered key is reported instead, because the resolver never
          consults the operator store for one — it falls through to the legacy
          in-memory path — so /ops/feature-flags would still list the row and
          offer a toggle that silently changes nothing
      And the one historical exception is named explicitly rather than counted

    @unit
    Scenario: a frontend flag classified SYSTEM is declared, not discovered
      Given the flags exposed to the frontend that resolve to a SYSTEM-scoped definition
      Then they match the declared register of such flags exactly
      And a new SYSTEM classification therefore arrives as a visible edit for
          review, because scope decides which section the flag lands in and
          which badge it carries, and moving one out of PRODUCT also drops the
          fleet-reach warning, even though scope no longer decides resolution

  Rule: Operators manage flags from the Ops Feature Flags page

    Scenario: Ops Feature Flags page lists every registered flag with its current resolved value
      Given an operator with ops:view permission opens /ops/feature-flags
      Then the page lists every flag declared in the registry
      And each row shows the flag's scope, description, registry default,
          postgres value, and effective resolved value
      And rows whose effective value comes from an env override show an
          "env override" badge so operators do not get confused by an
          unresponsive toggle

    @integration
    Scenario: The Product section names this store as what customers actually get
      Given an operator opens /ops/feature-flags on a shared install
      Then the Product section says the value set here is what customers get
           when no targeting rule matches and no env override is configured
      And it names no external flag service, because none is in the chain

    @integration
    Scenario: The System section names the same chain, so the two cannot disagree
      Given an operator opens /ops/feature-flags
      Then the System section names env, this postgres store, and the registry
           default as the places a value comes from, in that order
      And it names no external flag service either

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

    @integration
    Scenario: Ops page warns about the blast radius of a PRODUCT flag on a shared install
      Given the installation is running in SaaS mode
      And a PRODUCT-scoped flag is listed
      Then the row carries a fleet-reach badge that a self-hosted install does
           not show
      And the badge explains that a value set here reaches every organization
          that no targeting rule matches, which on a shared install is the
          whole fleet
      And the explanation points the operator at a per-organization or
          per-project rule for a rollout
      And that explanation sits on the badge's accessible label rather than on
          hover alone, so it survives a reader who never hovers

  Rule: Self-hosted parity

    Scenario: Flipping a kill switch works the same self-hosted as on a shared install
      Given the installation is self-hosted
      When an operator toggles a SYSTEM kill switch from the Ops UI
      Then the change persists in postgres and every pod observes it, exactly
           as it would on a shared install
      And nothing in the chain reaches outside the install, because the
          resolver has no third-party service in it on any deployment
