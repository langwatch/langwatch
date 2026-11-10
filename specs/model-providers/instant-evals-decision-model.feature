Feature: Instant Evals decision model column in Default models
  As an organization admin
  I want to pick the decision model Instant Evals run on, per organization, team or project
  So that Instant Evals run on LangWatch's hosted model by default, or on our own provider key

  # ADR-182. LangWatch Evals Preview is the hosted, metered default. An own decision model
  # runs on the organization's key, unmetered and uncapped, behind the
  # release_instant_evals_own_decision_model flag, on by default. A broken own key never falls back.

  Background:
    Given an organization with a project

  # --- The flag ---

  @unit
  Scenario: Own decision models are on by default
    When the flag registry is read
    Then the own decision model flag is a product flag, on unless switched off

  # --- Resolving the column ---

  @unit
  Scenario: An unset column runs on LangWatch Evals Preview
    Given the Instant Evals column is not set at any scope
    When the project's decision model is resolved
    Then it resolves to LangWatch Evals Preview

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
  Scenario: A project's own key wins over an older organization key
    Given the organization saved an OpenAI key before the project saved its own
    When the project's OpenAI row is looked up
    Then the project's row is answered, as the settings page lists it

  @unit
  Scenario: A saved decision model or key judges the next run
    Given the project's decision model was resolved
    When five seconds have passed
    Then the next resolve reads the stored column and row again

  # A provider whose host differs per customer (Azure) gets only the resource name from the row;
  # the catalogue writes the rest of the URL, so a key still goes only to its issuer's domain.

  @unit
  Scenario: An Azure decision model is sent to the project's own Azure resource
    Given the flag is on for the organization
    And the Instant Evals column is "Azure OpenAI Decisions API"
    And the project's Azure row has a key and the endpoint "https://acme.openai.azure.com/"
    When the project's decision model is resolved
    Then it resolves to "https://acme.openai.azure.com/openai/v1/decisions"
    And the key is sent in the "api-key" header, never as a bearer token
    And a deployment name stored on the row replaces the model name in the request

  @unit
  Scenario: An admin can name the Azure deployment of a decision model
    When an admin edits the project's Azure provider without the API gateway
    Then the form shows an optional deployment name for each Azure decision model
    And the deployment names are shown as typed, never masked as a secret

  @unit
  Scenario: An Azure key is never sent to a host outside Azure
    Given the flag is on for the organization
    And the Instant Evals column is "Azure OpenAI Decisions API"
    And the project's Azure row points at a gateway, a lookalike domain, plain http or a custom port
    When the project's decision model is resolved
    Then it resolves as unavailable because the endpoint is not allowed
    And the call is skipped as a key problem, never sent

  @unit
  Scenario: Every catalogue entry can be reached with the key it names
    When the decision model catalogue is read
    Then every own entry names a registry provider, an https endpoint and a wire format
    And every placeholder in an endpoint is filled from a field of that provider's row
    And no two entries share an id

  @unit
  Scenario: With the flag off an own decision model is not run and not moved onto the billed model
    Given the flag is off for the organization
    And the Instant Evals column is "OpenAI Decisions API"
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
    When the decision model is resolved for a caller picking "OpenAI Decisions API"
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
    When the decision model is resolved for a caller picking "OpenAI Decisions API"
    Then it resolves as unavailable because it is not enabled

  @unit
  Scenario: A caller picking LangWatch Evals Preview runs on the hosted model
    Given the flag is on for the organization
    And the Instant Evals column is "Cloudflare Clef"
    When the decision model is resolved for a caller picking "LangWatch Evals Preview"
    Then it resolves to LangWatch Evals Preview
    And no provider row is read

  @unit
  Scenario: A caller's pick that is not a decision model is ignored
    Given the flag is on for the organization
    And the Instant Evals column is "OpenAI Decisions API"
    And the project has an enabled OpenAI row with a key
    When the decision model is resolved for a caller picking a chat model
    Then the project's column is resolved instead

  @unit
  Scenario: One caller's pick never answers for another caller
    Given the flag is on for the organization
    And the Instant Evals column is not set at any scope
    And the project has an enabled OpenAI row with a key
    When one caller resolves with a pick and another resolves with none
    Then the second answers LangWatch Evals Preview, not the first caller's pick

  # --- Offering the models ---

  @unit
  Scenario: With the flag off only LangWatch Evals Preview is offered
    Given the flag is off for the organization
    When the project's pickable decision models are listed
    Then only "LangWatch Evals Preview" is offered

  @unit
  Scenario: With the flag on the models that would run are offered
    Given the flag is on for the organization
    And the project has an enabled OpenAI row with a key
    And the project has no Inception row
    When the project's pickable decision models are listed
    Then "LangWatch Evals Preview" is offered first
    And "OpenAI Decisions API" is offered
    And "Inception Mercury Decide" is not offered

  @unit
  Scenario: A provider is asked for once however many of its models the catalogue holds
    Given the flag is on for the organization
    And the project has an enabled Perplexity row with a key
    When the project's pickable decision models are listed
    Then both Perplexity models are offered
    And the Perplexity row is read once

  @unit
  Scenario: A config row offers the models its own scope runs, not the page's project
    Given the flag is on for the organization
    And project "A" has an enabled OpenAI row with a key
    And the page is on project "C", which has no OpenAI row
    When the pickable decision models are listed for a config on project "A"
    Then "OpenAI Decisions API" is offered

  @unit
  Scenario: An organization row is not offered a key only one project holds
    Given the flag is on for the organization
    And only project "A" has an enabled OpenAI row with a key
    When the pickable decision models are listed for a config on the organization
    Then only "LangWatch Evals Preview" is offered

  @unit
  Scenario: A config on several scopes is offered only what every scope runs
    Given the flag is on for the organization
    And project "A" has an enabled OpenAI row with a key
    And project "B" has none
    When the pickable decision models are listed for a config on projects "A" and "B"
    Then "OpenAI Decisions API" is not offered

  @unit
  Scenario: Scopes from another organization are refused
    When the pickable decision models are listed for a scope outside the project's organization
    Then the request is refused

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
  Scenario: Picking an own decision model for a scope with no key for it is refused
    Given the flag is on for the organization
    And only project "A" has an enabled Inception row with a key
    When an admin sets the Instant Evals column of an organization config to "Inception Mercury Decide"
    Then the write is refused saying a scope has no key for it

  @unit
  Scenario: A kept own decision model is checked only on the scopes it gains
    Given the flag is on for the organization
    And a config on project "A" stores "Inception Mercury Decide" in the Instant Evals column
    And project "B" has no Inception row
    When an admin adds project "B" to the config
    Then the write is refused saying a scope has no key for it

  @unit
  Scenario: The column only takes decision models
    When an admin sets the Instant Evals column to a chat model
    Then the write is refused saying it is not a decision model

  @unit
  Scenario: A decision model cannot be another role's default
    When an admin sets the Default column to "OpenAI Decisions API"
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
  Scenario: A model or deployment the account does not hold is skipped as not configured
    When the provider answers 404
    Then the text is skipped as "classifier_not_configured" after one attempt
    And the run is not failed over it

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
  Scenario: The Default models table shows an Instant Evals column defaulting to LangWatch Evals Preview
    When I open Settings > Model Providers > Default models
    Then I see an "Instant Evals" column
    And it reads "Evals Preview" with the LangWatch mark where nothing is set

  @unit
  Scenario: A decision model's full name opens with its provider
    When a decision model is listed in a picker
    Then its full name opens with the provider, such as "Inception Mercury Decide"
    And OpenAI's and Azure OpenAI's Decisions models read "Decisions API" beside their provider icon
    And their full names, "OpenAI Decisions" and "Azure OpenAI Decisions", name the provider and the API, not the model
    And LangWatch's hosted model reads "Evals Preview", described as "Optimized for evals"

  @integration
  Scenario: The drawer offers only decision models for the Instant Evals column
    Given the flag is off for my organization
    When I edit the Instant Evals column
    Then I can pick only "Evals Preview"
    And no other decision model is listed, not even with a hint to add a key

  @integration
  Scenario: The drawer offers only the decision models that would run
    Given the flag is on for my organization
    And my project has an OpenAI key and no Inception key
    When I edit the Instant Evals column
    Then I can pick "Evals Preview" and OpenAI's "Decisions API"
    And "Inception Mercury Decide" is listed but cannot be picked, so every pick I can make runs

  @integration
  Scenario: The decision model picker is one flat list with LangWatch's models first
    Given the flag is on for my organization
    When I edit the Instant Evals column
    Then "Evals Preview" is the first row, checked while the column is unset
    And with the judge router flag on, "Scenario Judge Preview" and "Search Preview" follow it, listed but not pickable yet
    And no row is a provider heading or a separate "Default" row
    And every row shows its provider icon, its title and a one-line description

  @integration
  Scenario: Picking Evals Preview stores it, so a wider scope cannot take the column over
    Given the Instant Evals column is not set at any scope
    When I pick "Evals Preview" for the Instant Evals column and save
    Then the config stores "Evals Preview" for the Instant Evals column
    And a config whose only value is that pin can be saved
    And once it is stored, the inherit entry is listed so the pin can be cleared

  @integration
  Scenario: The Instant Evals feature picker lists Evals Preview once, with no Default row
    Given neither the Instant Evals column nor its feature is set at any scope
    When I open the Instant Evals feature picker
    Then "Evals Preview" is listed once and checked
    And no "Default" row that reads "Evals Preview" is listed beside it

  @integration
  Scenario: A model two providers offer is told apart by its provider
    Given the flag is on for my organization
    And my project has an OpenAI key and an Azure OpenAI key
    When I edit the Instant Evals column
    Then two rows read "Decisions API", one with the OpenAI icon and one with the Azure icon

  @integration
  Scenario: A decision model whose provider has no key says how to enable it
    Given the flag is on for my organization
    And my project has no Inception key
    When I edit the Instant Evals column
    Then "Inception Mercury Decide" reads "Add an Inception key in Model Providers to use it."
    And it cannot be picked

  @unit
  Scenario: With the router flag on LangWatch Evals Preview says it routes
    Given the judge router flag is on for my organization
    When the Instant Evals choices are built
    Then "Evals Preview" reads "Optimized for evals, routed"
    And with the router flag off it reads "Optimized for evals"

  @integration
  Scenario: The drawer asks about the picked scopes, not the page's project
    Given I am on project "C"
    When I edit a config row scoped to the organization
    Then the Instant Evals choices are asked for the organization scope
    And with no scope picked only "LangWatch Evals Preview" is offered

  @integration
  Scenario: Each decision model provider draws its own brand mark
    When the icon for a decision model provider is drawn
    Then the LangWatch hosted model draws the LangWatch logo
    And Inception, Perplexity, Cloudflare, TypeSafe, OpenRouter and Fireworks each draw a mark of their own, not the generic one
