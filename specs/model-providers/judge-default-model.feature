Feature: Judge column in Default models
  As an organization admin
  I want to pick the model scenario runs judge with, per organization, team or project
  So that scenario judging can run on a different model from the rest of the platform

  # JUDGE is a role beside DEFAULT, FAST, LANGY, EMBEDDINGS and INSTANT_EVALS, stored in the same
  # default-model config map, so no migration is needed. Its one feature is "scenarios.judge".
  # Unset at every scope, it reads the Default model, which is what the judge ran on before the
  # column existed. A LangWatch-hosted judge model will later replace that fallback.

  Background:
    Given an organization with a project

  # --- The registry ---

  @unit
  Scenario: The scenario judge is the Judge role's feature
    Given the model feature registry
    Then "scenarios.judge" is registered under the JUDGE role
    And the JUDGE role falls back to the DEFAULT role when unset

  # --- Resolving the judge model ---

  @unit
  Scenario: A Judge pick resolves as the scenario judge model
    Given the Judge column is set at the organization
    And the Default column is set at the project
    When the project's "scenarios.judge" model is resolved
    Then it resolves to the organization's Judge pick

  @unit
  Scenario: An unset Judge column resolves to the Default model
    Given the Judge column is not set at any scope
    And the Default column is set at the organization
    When the project's "scenarios.judge" model is resolved
    Then it resolves to the organization's Default model

  @unit
  Scenario: A saved scenario judge override keeps winning
    Given a config saved before the Judge column existed pins "scenarios.judge" at the project
    And the Default column is set at the project
    When the project's "scenarios.judge" model is resolved
    Then it resolves to the pinned scenario judge model

  @unit
  Scenario: A scenario run judges with the Judge model
    Given the Judge column is set at the project
    And the scenario and the run plan pick no judge model
    When the run's models are resolved
    Then the judge model is the project's Judge pick

  # --- The table ---

  @integration
  Scenario: The table shows a Judge column after Instant Evals
    Given a config exists for the organization
    When I open the Default models table
    Then the last role column is "Judge", after "Instant Evals"

  @integration
  Scenario: An unset Judge cell shows the Default model faded
    Given a config sets only the Default column
    When I open the Default models table
    Then the config's Judge cell shows the Default model, faded as inherited

  # --- The drawer ---

  @integration
  Scenario: The drawer has an editable Judge row under Instant Evals
    When I open the "Add default models" drawer
    Then a "Judge" row sits under the "Instant Evals" row
    And it offers the same chat models as the Default row
    And "Scenario judge" is listed under it

  @integration
  Scenario: An unset Judge row inherits the Default model
    Given I picked a Default model in the drawer
    When I look at the Judge row
    Then it inherits that Default model

  # --- The Judge picker ---

  @unit
  Scenario: The Judge picker lists no decision model
    Given the judge router flag is on for my organization
    And own decision models are on for my organization
    When the Judge picker's choices are built
    Then no LangWatch decision model and no own decision model is listed
    And the LLMs are the choices

  @integration
  Scenario: The Judge picker offers only models that can judge a scenario
    Given the judge router flag is on for my organization
    And own decision models are on for my organization
    When I open the Judge picker
    Then no decision model is listed
    And the inherit row comes first, then the LLMs
    And every LLM reads as its provider icon and model id, with no description and no provider heading

  # LangWatch Judge (preview): LangWatch's own scenario judge, behind its own flag

  @unit
  Scenario: LangWatch Judge (preview) may be held by the Judge column and the scenario judge only
    Given the model langwatch/judge-preview
    When each Default models column and each feature is asked whether it may hold it
    Then only the Judge column and the scenario judge may
    And a feature that reads another column steps over it

  @unit
  Scenario: The Judge picker lists LangWatch Judge (preview) first where its flag is on
    Given the judge preview flag is on for my organization
    When the Judge picker's choices are built
    Then LangWatch Judge (preview) comes first, with what it is optimized for under its name
    And the LLMs follow

  @unit
  Scenario: The Judge picker never lists LangWatch Judge (preview) where its flag is off
    Given the judge preview flag is off, as on every self-hosted install by default
    When the Judge picker's choices are built
    Then only the LLMs are listed

  @integration
  Scenario: The drawer's Judge row offers LangWatch Judge (preview) where its flag is on
    Given the judge preview flag is on for my organization
    When I open the Judge picker in the Default models drawer
    Then LangWatch Judge (preview) is listed right after the inherit row
    And no other column lists it

  @integration
  Scenario: A scenario's judge picker offers LangWatch Judge (preview) where its flag is on
    Given the judge preview flag is on for my organization
    When I open a scenario's or a suite's Judge picker
    Then LangWatch Judge (preview) is listed first
    And the user simulator picker does not list it
    And with the flag off neither picker lists it
    And the flag is asked of the organization alone, as the Default models drawer asks it

  @unit
  Scenario: Saving LangWatch Judge (preview) as the Judge default stores it as picked
    Given the judge preview flag is on for my organization
    When a Default models config picks langwatch/judge-preview for Judge
    Then the config is stored with langwatch/judge-preview under Judge, never another model's id

  @unit
  Scenario: Saving LangWatch Judge (preview) is refused where its flag is off
    Given the judge preview flag is off for my organization
    When a Default models config newly picks langwatch/judge-preview for Judge
    Then the save is refused, saying it is not available for this organization yet
    And a config that already held it saves its other keys

  @unit
  Scenario: Saving LangWatch Judge (preview) under another column is refused
    Given the judge preview flag is on for my organization
    When a Default models config picks langwatch/judge-preview for Default or Fast
    Then the save is refused, saying it can only be the Judge default
    And picked for Instant Evals it is refused as not a decision model

