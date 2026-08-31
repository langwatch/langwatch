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

  Rule: A flag read states the project and the organization it is about

    # A rule that names an organization can only match a read that carries
    # that organization. A read that leaves the id out loses every rule
    # written for it and falls through to the row-level default, which is how
    # an organization rollout reached nobody in a customer report. The type of
    # a flag read therefore holds both ids, and a caller with no such id says
    # so instead of leaving the field out.

    @unit
    Scenario: a read that omits an id does not compile
      Given a caller reads a feature flag
      When the caller writes neither the project nor the organization
      Then the code does not compile, because both fields are required

    @unit
    Scenario: a caller with no project of its own opts that scope out by name
      Given a surface that exists outside any project, such as a screen shown
            before a project is chosen
      When it reads a flag
      Then it states the opt-out value for the project
      And the value it states is the one the flag module exports for this
          purpose, so the choice is readable at the call site

    @unit
    Scenario: an opted-out scope matches no rule that names that scope
      Given a flag with one rule that names a project
      When the flag is read with the project scope opted out
      Then the rule does not match
      And the read falls through to the row-level default

    @unit
    Scenario: an id that is not known yet is written out, not left out
      Given a caller whose organization is still loading
      When it reads a flag
      Then it writes the organization as not known yet
      And it disables the read until the organization arrives, so the read
          never resolves against an empty context by accident

    @unit
    Scenario: a read that carries the organization matches an organization rule
      Given a flag that is off by default with one rule naming an organization
      When the flag is read with that organization and with a project
      Then the flag resolves enabled from the rule

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

  Rule: A rollout can name the age of an organization instead of its id

    # An operator rolling a feature out to "new users only" cannot write the
    # ids of organizations that do not exist yet, and re-editing the rule list
    # on every signup is not a rollout strategy. A New users rule names one
    # date instead, and every organization created on or after it matches,
    # while every organization that predates it keeps exactly the value it
    # had.

    @unit
    Scenario: a new-users rule enables the flag for an organization created after its date
      Given a flag that is off by default
      And a rule naming the date the rollout starts, with enabled true
      When the flag is read for an organization created after that date
      Then the flag resolves enabled from the rule

    @unit
    Scenario: an organization that predates the rollout date sees no change
      Given the same flag and rule
      When the flag is read for an organization created before that date
      Then the rule does not match
      And the read falls through to the row-level default, so an existing
          customer keeps the value it already had

    @unit
    Scenario: an organization created on the rollout date itself is included
      Given a rule naming a date
      When the flag is read for an organization created at the very start of
           that date
      Then the rule matches, because the boundary is inclusive and an operator
           reads the date as "from this day on"

    @unit
    Scenario: a read with no organization creation date matches no age rule
      Given a flag whose only rule names a date
      When the flag is read from a surface that opts the organization scope out
      Then the rule does not match, because an age rule fails closed rather
           than reaching every caller whose age is unknown

    @unit
    Scenario: a stored rule whose date cannot be read never matches
      Given a stored rule whose date is not a date at all
      When the flag is read for any organization
      Then the rule does not match, and the read falls through to the
           row-level default

    @unit
    Scenario: the creation date is fetched only for a flag that has an age rule
      Given a flag whose rules name only organizations and projects
      When the flag is read
      Then no organization record is read, because no rule asks for a date

    @unit
    Scenario: the creation date is fetched once and reused across reads
      Given a flag carrying an age rule
      When the flag is read repeatedly for the same organization
      Then the organization's creation date is read once and served from cache
           afterwards, because a creation date never changes

    @unit
    Scenario: no creation date is fetched for an age rule that cannot be reached
      Given a flag whose rules put an everyone rule above a New users rule
      When the flag is read
      Then no organization record is read, because the everyone rule settles
           the flag before the age rule is ever consulted

    @unit
    Scenario: an operator cannot save an age rule without a readable date
      Given an operator writes a New users rule from the Ops UI
      When the date is blank or is not a date
      Then the write is rejected, because a rule that can never match is a
           rule the operator believes is live

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
    Scenario: The Product section tells operators what the value they set actually reaches
      Given an operator opens /ops/feature-flags on a shared install
      Then the Product section says customers get the value set here when no
           targeting rule matches and no env override is configured
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
      And that explanation is rendered into the page rather than living only in
          hover-only tooltip content, so an operator who never hovers — or who
          reads the page with a screen reader — is warned too

    @integration
    Scenario: The page leads with the flags operators actually roll out
      Given an operator opens /ops/feature-flags
      Then the Product section comes before the System section, because a
           product rollout is the daily reason to open this page and a kill
           switch is the exception

  Rule: The targeting rules dialog keeps the catch-all rule last

    # Rules are first-match-wins, so a rule placed below one that matches
    # everyone can never fire. Appending to the end of a list that ends in
    # "Everyone" therefore produces a rule that looks live and is dead.

    @unit
    Scenario: a new rule lands above a trailing everyone rule
      Given the rules for a flag end with a rule that applies to everyone
      When the operator adds a rule
      Then the new rule is placed directly above the everyone rule

    @unit
    Scenario: a new rule is appended when the list does not end in everyone
      Given the rules for a flag end with an organization rule
      When the operator adds a rule
      Then the new rule is placed at the end of the list

    @integration
    Scenario: an operator reorders rules from the keyboard
      Given a flag with more than one targeting rule
      When the operator moves a rule using only the keyboard
      Then the order changes, because rule order is what decides the flag and
           an operator who cannot drag would have no say in it

    @integration
    Scenario: an operator reorders rules by dragging them
      Given a flag with more than one targeting rule
      Then every rule carries a drag handle
      And moving a rule changes the order the rules are saved in, which is the
          order they are evaluated in

  Rule: The note under a flag says who its rules have switched it on for

    # The note is read while the flag's own toggle is off, so it is the only
    # place the page says the flag is live somewhere. It walks the rules the
    # way the resolver does, because a note that disagrees with the resolver
    # is worse than no note.

    @unit
    Scenario: a catch-all note admits the targets a rule above it excludes
      Given a rule turns a flag off for one organization
      And a later rule turns it on for everyone
      When the note is written
      Then it says the flag is on for everyone except that organization

    @unit
    Scenario: a new-users rule an earlier rule already answered for is not claimed
      Given a rule turns a flag off for organizations created since January
      And a later rule turns it on for organizations created since June
      When the note is written
      Then it does not offer June, because every organization created since
           June was created since January and the earlier rule answers first

  Rule: The rules dialog offers New users as a scope of its own

    @integration
    Scenario: picking New users asks for a date instead of an id
      Given an operator opens the targeting rules for a flag
      When the operator picks the New users scope for a rule
      Then the field beside it asks for the organization creation date rather
           than an organization id
      And the field takes a date

    @integration
    Scenario: a saved New users rule reopens as a New users rule
      Given a flag whose stored rule names an organization creation date
      When the operator opens the targeting rules
      Then the rule shows the New users scope with that date filled in

    @unit
    Scenario: a condition the dialog has no field for survives an edit
      Given a stored rule that names both an organization and a creation date
      When the operator saves the dialog without touching that rule
      Then the saved rule still carries both conditions, because dropping one
           would widen the rollout to that organization's whole history

  Rule: Self-hosted parity

    Scenario: Flipping a kill switch works the same self-hosted as on a shared install
      Given the installation is self-hosted
      When an operator toggles a SYSTEM kill switch from the Ops UI
      Then the change persists in postgres and every pod observes it, exactly
           as it would on a shared install
      And nothing in the chain reaches outside the install, because the
          resolver has no third-party service in it on any deployment
