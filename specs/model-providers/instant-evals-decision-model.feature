Feature: Instant Evals decision model column in Default models
  As an organization admin
  I want to pick the decision model Instant Evals run on, per organization, team or project
  So that Instant Evals run on LangWatch's hosted model by default, or on our own provider key

  # ADR-182. LangWatch Instant Preview is the hosted, metered default. An own decision model
  # runs on the organization's key, unmetered and uncapped, behind the
  # release_instant_evals_own_decision_model flag. A broken own key never falls back.

  Background:
    Given an organization with a project

  # --- Resolving the column ---

  @unit
  Scenario: An unset column runs on LangWatch Instant Preview
    Given the Instant Evals column is not set at any scope
    When the project's decision model is resolved
    Then it resolves to LangWatch Instant Preview

  @unit
  Scenario: An own decision model with a key resolves with its endpoint and key
    Given the flag is on for the organization
    And the Instant Evals column is "Cloudflare Clef"
    And the project has an enabled Cloudflare row with an account id and a token
    When the project's decision model is resolved
    Then it resolves to the own model with the account id filled into the endpoint

  @unit
  Scenario: An own decision model with no provider row cannot run
    Given the flag is on for the organization
    And the Instant Evals column is "Inception Mercury Decide"
    And the project has no Inception row
    When the project's decision model is resolved
    Then it resolves as unavailable because the provider is missing

  @unit
  Scenario: An own decision model whose row is switched off cannot run
    Given the flag is on for the organization
    And the Instant Evals column is "Perplexity Decider v1.2"
    And the project's Perplexity row is switched off
    When the project's decision model is resolved
    Then it resolves as unavailable because the provider is switched off

  @unit
  Scenario: An own decision model with no key cannot run
    Given the flag is on for the organization
    And the Instant Evals column is "Cloudflare Clef"
    And the project's Cloudflare row has a token but no account id
    When the project's decision model is resolved
    Then it resolves as unavailable because the key is missing

  @unit
  Scenario: With the flag off an own decision model is not run and not moved onto the billed model
    Given the flag is off for the organization
    And the Instant Evals column is "OpenAI Decisions (gpt-6-luna)"
    When the project's decision model is resolved
    Then it resolves as unavailable because it is not enabled
    And the call is skipped as not configured

  # --- A caller's own pick ---

  # One judge may ask for a decision model of its own. The pick travels through the resolver as
  # an override, so the flag guard, the key guard and the skip handling all apply unchanged.

  @unit
  Scenario: A caller's own decision model pick is resolved instead of the column
    Given the flag is on for the organization
    And the Instant Evals column is not set at any scope
    And the project has an enabled OpenAI row with a key
    When the decision model is resolved for a caller picking "OpenAI Decisions (gpt-6-luna)"
    Then it resolves to the own model with its endpoint and key
    And the project's column is not read

  @unit
  Scenario: A caller's pick with no key cannot run and is not moved onto the billed model
    Given the flag is on for the organization
    And the project has no Inception row
    When the decision model is resolved for a caller picking "Inception Mercury Decide"
    Then it resolves as unavailable because the provider is missing

  @unit
  Scenario: A caller's pick is refused without the flag
    Given the flag is off for the organization
    When the decision model is resolved for a caller picking "OpenAI Decisions (gpt-6-luna)"
    Then it resolves as unavailable because it is not enabled

  @unit
  Scenario: A caller picking LangWatch Instant Preview runs on the hosted model
    Given the flag is on for the organization
    And the Instant Evals column is "Cloudflare Clef"
    When the decision model is resolved for a caller picking "LangWatch Instant Preview"
    Then it resolves to LangWatch Instant Preview
    And no provider row is read

  @unit
  Scenario: A caller's pick that is not a decision model is ignored
    Given the flag is on for the organization
    And the Instant Evals column is "OpenAI Decisions (gpt-6-luna)"
    And the project has an enabled OpenAI row with a key
    When the decision model is resolved for a caller picking a chat model
    Then the project's column is resolved instead

  @unit
  Scenario: One caller's pick never answers for another caller
    Given the flag is on for the organization
    And the Instant Evals column is not set at any scope
    And the project has an enabled OpenAI row with a key
    When one caller resolves with a pick and another resolves with none
    Then the second answers LangWatch Instant Preview, not the first caller's pick

  # --- Offering the models ---

  @unit
  Scenario: With the flag off only LangWatch Instant Preview is offered
    Given the flag is off for the organization
    When the project's pickable decision models are listed
    Then only "LangWatch Instant Preview" is offered

  @unit
  Scenario: With the flag on the models that would run are offered
    Given the flag is on for the organization
    And the project has an enabled OpenAI row with a key
    And the project has no Inception row
    When the project's pickable decision models are listed
    Then "LangWatch Instant Preview" is offered first
    And "OpenAI Decisions (gpt-6-luna)" is offered
    And "Inception Mercury Decide" is not offered

  @unit
  Scenario: A provider is asked for once however many of its models the catalogue holds
    Given the flag is on for the organization
    And the project has an enabled Perplexity row with a key
    When the project's pickable decision models are listed
    Then both Perplexity models are offered
    And the Perplexity row is read once

  # --- Writing the column ---

  @unit
  Scenario: Picking an own decision model is refused without the flag
    Given the flag is off for the organization
    When an admin sets the Instant Evals column to "Inception Mercury Decide"
    Then the write is refused saying own decision models are not enabled

  @unit
  Scenario: Keeping an already stored own decision model is not refused
    Given the flag is off for the organization
    And a config already stores "Inception Mercury Decide" in the Instant Evals column
    When an admin changes another column of the same config
    Then the write is accepted

  @unit
  Scenario: The column only takes decision models
    When an admin sets the Instant Evals column to a chat model
    Then the write is refused saying it is not a decision model

  @unit
  Scenario: A decision model cannot be another role's default
    When an admin sets the Default column to "OpenAI Decisions (gpt-6-luna)"
    Then the write is refused saying it can only be the Instant Evals default

  # --- Calling an own decision model ---

  @unit
  Scenario: OpenAI Decisions questions are sent as named questions and read back by name
    Given a yes or no question, a score question and a choice question
    When they are sent to OpenAI Decisions
    Then each is sent as a named predicate, score or choice question
    And the answers are read back by name into verdicts

  @unit
  Scenario: Cloudflare's answer is read from inside its result envelope
    When Cloudflare answers inside a "result" envelope
    Then the verdicts are read from the envelope

  @unit
  Scenario: An own decision model's answer bills nothing to LangWatch
    When an own decision model answers
    Then the judgement reports no billed tokens

  @unit
  Scenario: A refused key is not retried and names the key as the reason
    When the provider answers 401
    Then the text is skipped as "classifier_key_invalid" after one attempt
    And the provider's error text is not read

  @unit
  Scenario: A rate limited provider is retried, then named as rate limited
    When the provider answers 429 on every attempt
    Then the text is skipped as "classifier_rate_limited"

  @unit
  Scenario: A provider outage is retried, then named as unavailable
    When the provider answers 503 on every attempt
    Then the text is skipped as "classifier_provider_unavailable"

  # --- Metering ---

  @unit
  Scenario: An LLM judge on an own decision model is not metered or capped
    Given a judge call carries an own decision model
    When the judge answers it
    Then no project placement, budget or spend is read or written
    And the price is zero

  @unit
  Scenario: Instant Evals on an own decision model go to the judge with the key
    Given the project resolves to an own decision model
    When Instant Evals classify a text
    Then the judge leaf is called with the own model
    And LangWatch's classifier is not called

  @unit
  Scenario: Instant Evals on an unavailable own decision model never fall back
    Given the project resolves to an own decision model that cannot run
    When Instant Evals classify a text
    Then the text is skipped as "classifier_key_invalid"
    And LangWatch's classifier is not called

  @unit
  Scenario: A run whose own decision model cannot answer skips its rows by reason
    Given a run page whose own decision model refused the key, rate limited or was down
    When the page's judgements are written
    Then each row is skipped under that reason, not counted as a failure
    And the page is not thrown back to be judged again

  @integration
  Scenario: The search bar stays on LangWatch's classifier with an own decision model
    Given the project resolves to an own decision model
    When the search bar classifies a sentence
    Then LangWatch's classifier is called
    And the judge leaf is never called with the own model

  @unit
  Scenario: The free budget never binds a project on an own decision model
    Given the project resolves to an own decision model
    When a run checks the free budget
    Then the budget does not bind it

  @unit
  Scenario: An LLM judge on an unavailable own decision model says how to fix it
    Given the project resolves to an own decision model whose key is missing
    When an LLM judge evaluation runs on Instant Evals
    Then the result is an error naming "classifier_key_invalid"
    And the details say to check the key in Settings > Model Providers

  # --- Settings UI ---

  @integration
  Scenario: The Default models table shows an Instant Evals column defaulting to LangWatch Instant Preview
    When I open Settings > Model Providers > Default models
    Then I see an "Instant Evals" column
    And it reads "LangWatch Instant Preview" where nothing is set

  @integration
  Scenario: The drawer offers only decision models for the Instant Evals column
    Given the flag is off for my organization
    When I edit the Instant Evals column
    Then I can pick only "LangWatch Instant Preview"

  @integration
  Scenario: Each decision model provider draws its own brand mark
    When the icon for a decision model provider is drawn
    Then the LangWatch hosted model draws the LangWatch logo
    And Inception, Perplexity and Cloudflare each draw a mark of their own, not the generic one
