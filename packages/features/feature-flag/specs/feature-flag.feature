# ADR: packages/features/feature-flag/adrs/001-feature-flag-service-boundary.md

Feature: Resolve a feature flag, roll it out, and let people opt into experiments
  As an operator running LangWatch
  I want flags resolved from our own registry, operator store and environment,
  with per-tenant targeting, deterministic percentage rollout, and experiments
  people can join
  So that hot paths cost nothing external, self-hosted installations work with
  no configuration, and a rollout can be widened without anyone losing access

  Background:
    Given every flag the platform recognises is declared in one in-code registry
    And each entry declares a scope and a registry default
    And the registry default applies when nothing overrides it

  Rule: Resolution is environment, then force-enable, then operator store, then registry default

    @unit
    Scenario: An unconfigured deployment resolves a flag to its registry default
      Given no operator row exists for a registered flag
      When a caller resolves the flag
      Then the flag resolves to its registry default

    @unit
    Scenario: An operator row overrides the registry default
      Given an operator switched a registered flag off fleet-wide
      When a caller resolves the flag
      Then the flag resolves to off

    @unit
    Scenario: An environment override beats the operator row
      Given an operator switched a registered flag off fleet-wide
      And the flag's derived environment variable is set to on
      When a caller resolves the flag
      Then the flag resolves to on

    @unit
    Scenario: Environment overrides are fixed when the process boots
      Given boot parsed a registered flag with no environment override
      When the process environment changes after the service is composed
      Then resolution keeps using the validated boot configuration

    @unit
    Scenario: A legacy environment alias keeps working after a flag is registered
      Given a registered flag declares a legacy environment variable name
      And that legacy variable is set to a truthy value
      When a caller resolves the flag
      Then the flag resolves to on

    @unit
    Scenario: A flag can opt out of environment overrides entirely
      Given a registered flag declares that the environment cannot override it
      And its derived environment variable is set to on
      And an operator switched the flag off
      When a caller resolves the flag
      Then the flag resolves to off

    @unit
    Scenario: The force-enable list turns a flag on for local development
      Given an operator switched a registered flag off fleet-wide
      And the force-enable list names that flag
      When a caller resolves the flag
      Then the flag resolves to on

    @unit
    Scenario: A per-flag environment override beats the force-enable list
      Given the force-enable list names a registered flag
      And the flag's derived environment variable is set to off
      When a caller resolves the flag
      Then the flag resolves to off

    @unit
    Scenario: A key the registry does not define is refused
      Given a key that appears in no registry entry and matches no family
      When a caller resolves it
      Then resolution raises an unknown-flag error rather than inventing an answer

  Rule: Targeting rules override the row for the targets they name, and nobody else

    @unit
    Scenario: An organization-scoped rule enables a flag for that organization
      Given an operator wrote a rule enabling a flag for one organization
      When a caller in that organization resolves the flag
      Then the flag resolves to on

    @unit
    Scenario: A rule leaves the registry default intact for targets it does not name
      Given a default-on flag has no operator row
      And an operator writes a single per-project opt-out rule
      When a caller for a project the rule does not name resolves the flag
      Then the flag stays on, so one project's opt-out never turns the fleet off

    @unit
    Scenario: A rule cannot turn a default-off flag on fleet-wide
      Given a default-off flag has no operator row
      And an operator writes a rule enabling it for one organization
      When a caller the rule does not name resolves the flag
      Then the flag stays off

    @unit
    Scenario: The first matching rule wins
      Given a flag carries a broad rule followed by a narrower one
      When a caller matching both resolves the flag
      Then the earlier rule decides the result

    @unit
    Scenario: A rule condition the reader does not understand matches nobody
      Given a stored rule carries a match key this version does not recognise
      When any caller resolves the flag
      Then the rule does not match, so an unknown condition never matches everyone

  Rule: Percentage rollout is deterministic, independent per flag, and monotonic

    @unit
    Scenario: A person's bucket does not move as the rollout widens
      Given a percentage rule on a flag
      When the percentage is raised step by step to one hundred
      Then nobody admitted at a lower percentage is ever dropped at a higher one

    @unit
    Scenario: Two flags at the same percentage do not pick the same people
      Given two flags each rolled out to ten percent
      When the same population is bucketed for both
      Then the two audiences differ

    @unit
    Scenario: A rollout admits roughly the share it names
      Given a flag rolled out to twenty-five percent
      When a large population is bucketed
      Then close to a quarter of them are admitted

    @unit
    Scenario: Zero admits nobody and one hundred admits everybody
      Given a percentage rule on a flag
      When the percentage is zero
      Then nobody is admitted
      When the percentage is one hundred
      Then everybody with a bucketing subject is admitted

    @unit
    Scenario: A backend caller never satisfies a percentage rule
      Given a percentage rule on a flag
      When a system target resolves it at any percentage
      Then the rule does not match, because a system target is not a person

  Rule: Resolution degrades rather than failing the caller

    @unit
    Scenario: A database failure resolves the flag to its registry default
      Given the operator store cannot be read
      When a caller resolves a registered flag
      Then the flag resolves to its registry default rather than raising

    @unit
    Scenario: A malformed stored rules payload is ignored
      Given a flag's stored rules payload does not parse
      When a caller resolves the flag
      Then the rules are treated as empty rather than raising

    @unit
    Scenario: An operator write is visible to the next resolution
      Given an operator switched a default-on flag off
      When the operator clears the row
      Then the flag resolves to on again

  Rule: The public surface discloses only the flags meant to be public

    @unit
    Scenario: A signed-out browser cannot read an ordinary browser flag
      Given a browser flag that is not on the public allowlist
      When a signed-out browser resolves the public flags
      Then that flag's name and value are absent from the answer

    @unit
    Scenario: A signed-out browser reads a flag that opted into pre-authentication
      Given a flag on the public allowlist
      When a signed-out browser resolves the public flags
      Then the flag's value is returned

    @unit
    Scenario: An anonymous browser id is random and carries nothing about the machine
      When a signed-out browser needs an anonymous id
      Then a random v4 identifier is generated and stored on its own
      And nothing about the device, fonts, canvas or person is collected

    @unit
    Scenario: Clearing site data rotates the anonymous id
      Given a browser that already has an anonymous id
      When its stored site data is cleared
      Then the next resolution uses a different id

    @unit
    Scenario: A stored anonymous id that is not a v4 identifier is replaced
      Given the stored anonymous id has been tampered with
      When the browser reads its anonymous id
      Then a fresh random identifier replaces it

    @unit
    Scenario: Storage failure still yields a usable anonymous id
      Given the browser refuses to read or write site data
      When the browser reads its anonymous id
      Then an identifier stable for the page is used instead of failing

  Rule: Authenticated targets are authorised exactly

    @unit
    Scenario: A project cannot be paired with another organization
      Given a caller may view a project
      When they resolve it with an organization that does not own it
      Then the request is refused before the flag is evaluated

    @unit
    Scenario: Legacy organization maps do not reveal membership
      Given a caller requests flag values for organizations they do and do not belong to
      When the map is resolved
      Then organizations they do not belong to are absent rather than present as false

  Rule: An experiment is availability, then tenant policy, then the person's own choice

    @unit
    Scenario: An available experiment is off until the person joins it
      Given an experiment available to a person who has not joined it
      When they resolve their experiments
      Then it is listed and off

    @unit
    Scenario: A person joins an experiment for themselves
      Given an experiment available to a person
      When they join it
      Then it is on for them

    @unit
    Scenario: Leaving an experiment removes the enrolment rather than recording a refusal
      Given a person who joined an experiment and then left it
      When an owner later enables it for their organization
      Then it is on for them

    @unit
    Scenario: An owner disabling an experiment overrides a person's own choice
      Given a person who joined an experiment
      When an owner disables it for their organization
      Then it is off for them, and their own choice is still recorded

    @unit
    Scenario: A disabled experiment stays visible so an owner can reverse it
      Given an owner disabled an experiment for their organization
      When a member resolves their experiments
      Then it is still listed, so the reason it is off is visible

    @unit
    Scenario: A project policy overrides an organization policy
      Given an organization disabled an experiment
      And the project enabled it
      When a person in that project resolves it
      Then it is on

    @unit
    Scenario: Returning a policy to inherit hands the decision back to the person
      Given an owner enabled an experiment and then set it back to inherit
      When a person who never joined resolves it
      Then it is off

    @unit
    Scenario: An unreleased experiment is never announced
      Given an experiment the operator has not made available
      When a person resolves their experiments
      Then it is absent entirely rather than listed as unavailable

    @unit
    Scenario: Joining an experiment that is not available is refused
      Given an experiment the operator has not made available
      When a person tries to join it
      Then the request is refused as unavailable

    @unit
    Scenario: An operator switch-off outranks every tenant and personal choice
      Given an owner enabled an experiment and a person joined it
      When the operator has not made it available
      Then it is off

    @unit
    Scenario: A key that is not an experiment cannot be joined or governed
      Given a registered flag that carries no experiment metadata
      When a person tries to join it, or an owner tries to set a policy on it
      Then both are refused as unknown experiments

    @unit
    Scenario: A signed-out browser is shown no experiment that is not public
      Given an available experiment that did not opt into pre-authentication
      When a signed-out browser resolves its experiments
      Then nothing is returned

    @unit
    Scenario: A public experiment is decided for a signed-out browser by availability alone
      Given an available experiment marked for pre-authentication
      When a signed-out browser resolves its experiments
      Then it is on, decided by its bucket rather than by any preference

  Rule: Experiment definitions must be usable before they ship

    @unit
    Scenario: A backend kill switch cannot be offered as a personal choice
      Given a SYSTEM-scoped flag carrying experiment metadata
      When the registry is built
      Then it is refused

    @unit
    Scenario: An experiment the browser cannot see is refused
      Given an experiment that is not browser-visible
      When the registry is built
      Then it is refused

    @unit
    Scenario: An experiment with no customer-facing copy is refused
      Given an experiment with a blank title or summary
      When the registry is built
      Then it is refused

    @unit
    Scenario: Catalogue versions must strictly increase
      Given two experiments carrying the same catalogue version
      When the registry is built
      Then it is refused, because one watermark could not order them

    @unit
    Scenario: A pre-authentication experiment must be on the public allowlist
      Given an experiment marked for pre-authentication but absent from the allowlist
      When the registry is built
      Then it is refused

  Rule: Tenant policy is authorised against the exact scope it names

    @unit
    Scenario: Setting a project policy requires the manage permission on that project
      Given a member without featureFlags:manageExperiments on a project
      When they try to set an experiment policy for it
      Then the request is refused

    @integration @unimplemented
    Scenario: An anonymous browser cannot change enrolment or tenant policy
      Given a signed-out browser
      When it attempts an enrolment or a policy write
      Then the request is refused
