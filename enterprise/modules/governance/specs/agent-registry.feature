Feature: Agent registry with ARD discovery and change events

  An organisation's governance team reads one machine-readable registry of every agent LangWatch
  can see: agents defined in its projects, agents a governance source listed (Databricks Genie,
  Copilot Studio) and agents its traces name in `gen_ai.agent.name`; a traced agent no listed
  source accounts for is flagged shadow. Each entry carries its endpoints, model configuration, system instructions,
  callable tools with JSON Schema parameters, owner and a registry version. The same entries are
  published as an Agentic Resource Discovery (ARD v0.91) manifest with search. Every material
  change appends a numbered event to the organisation's feed, which is read by cursor and pushed
  to the organisation's webhook endpoints that subscribe to `governance.agent.*`.
  Docs: docs/governance/agent-registry.mdx

  Background:
    Given an organisation with a project and an organisation API key holding governance:view

  # Building entries

  @unit
  Scenario: A prompt-based agent becomes an entry with its model, instructions and callable tool
    Given a signature agent with model "openai/gpt-5-mini", temperature 0.2, a system prompt and an input "question"
    When the registry builds its entry
    Then the entry names provider "openai", model "gpt-5-mini" and parameter temperature 0.2
    And the entry carries the system prompt as its instructions
    And the entry lists one tool "invoke" whose input schema requires "question"

  @unit
  Scenario: A connected agent's declared parameters become its call tool, secrets without defaults
    Given a connected agent declaring a required string parameter "region" and a secret parameter "token" with a default
    When the registry builds its entry
    Then the entry lists one tool "call" with properties "region" and "token"
    And the "token" property carries no default value

  @unit
  Scenario: An HTTP agent exposes its URL as an endpoint and never its credentials
    Given an HTTP agent calling "https://agent.acme.test/run" with a bearer token
    When the registry builds its entry
    Then the entry lists the endpoint "https://agent.acme.test/run"
    And no part of the entry carries the bearer token

  @unit
  Scenario: An HTTP agent's URL is published without user info or credential parameters
    Given an HTTP agent calling "https://bot:secret@agent.acme.test/run?api_key=secret&region=eu"
    When the registry builds its entry
    Then the entry lists the endpoint "https://agent.acme.test/run?region=eu"

  @unit
  Scenario: A Copilot Studio agent a source listed becomes a discovered entry with its environment endpoint
    Given a discovered Copilot Studio agent in environment "https://org.crm.dynamics.com"
    When the registry builds its entry
    Then the entry's source is "copilot_studio" and its management is "discovered"
    And the entry lists the endpoint "https://org.crm.dynamics.com"

  @unit
  Scenario: An agent seen only in traffic is registered as observed and flagged shadow
    Given the project's spans in the last 30 days name an agent "pricing-bot" that no listed source names
    When the registry builds its drafts
    Then a draft "pricing-bot" with source "traffic", management "observed" and shadow true is built

  @unit
  Scenario: A traffic agent a listed source accounts for is not listed twice
    Given the project's spans name "Support Bot" and an agent whose gen_ai.agent.id is a LangWatch agent's id
    And a LangWatch agent named "support bot" exists
    When the registry builds its drafts
    Then no traffic draft is built for either

  @unit
  Scenario: A traced agent carrying a listed provider's agent id is not flagged shadow
    Given a Databricks Genie space "space-42" a source listed
    And the project's spans name an agent "genie-runner" whose gen_ai.agent.id is "space-42"
    When the registry builds its drafts
    Then no traffic draft is built for it

  # Versions and change events

  @unit
  Scenario: A new agent is registered at version 1
    Given the registry holds no entry for an agent
    When the registry reconciles and sees the agent
    Then the entry is stored at version 1
    And one "governance.agent.registered" event is appended with to_version 1

  @unit
  Scenario: A material change bumps the version and the event carries both versions
    Given the registry holds an agent at version 1
    When the agent's model changes and the registry reconciles
    Then the entry is stored at version 2
    And one "governance.agent.versioned" event is appended with from_version 1 and to_version 2

  @unit
  Scenario: A shadow agent's registration also flags it shadow
    Given the registry holds no entry for an agent seen only in traffic
    When the registry reconciles and sees the agent
    Then one "governance.agent.registered" and one "governance.agent.flagged_shadow" event are appended

  @unit
  Scenario: A change that only moves last seen keeps the version and appends nothing
    Given the registry holds an agent at version 1
    When only the agent's last seen time changes and the registry reconciles
    Then the entry stays at version 1
    And no event is appended

  @unit
  Scenario: A tool that disappears is marked deprecated, never dropped
    Given the registry holds an agent at version 1 with tools "call" and "search"
    When the agent's latest definition no longer has "search" and the registry reconciles
    Then the entry at version 2 lists "search" with status deprecated since version 2
    And one "governance.agent.tool_deprecated" event names the tool "search"

  @unit
  Scenario: An archived agent is removed from the active registry with an event
    Given the registry holds an active agent
    When the agent is no longer defined and the registry reconciles
    Then the entry's status is "removed"
    And one "governance.agent.removed" event is appended

  @unit
  Scenario: An agent's versions are read in pages, oldest first
    Given the registry holds an agent changed to version 3
    When a client reads its versions two at a time
    Then the first page holds versions 1 and 2 with a cursor
    And the page after that cursor holds version 3 and no cursor

  @unit
  Scenario: A source that cannot be read removes nothing
    Given the registry holds active agents
    When reading the organisation's agents fails during a reconcile
    Then the reconcile fails and every entry keeps its status and version

  @unit
  Scenario: A reconcile whose sources were read before a newer commit plans nothing
    Given a reconcile read its sources
    And another reconcile for the same organisation committed after that read
    When the first reconcile plans its changes
    Then it writes and announces nothing

  @unit
  Scenario: A traffic read that hit its cap removes no traced agent it did not read
    Given a project whose traffic read returned the per-project cap of agent names
    And the registry holds a traced agent of that project the read did not return
    When the registry reconciles
    Then that traced agent stays as it was

  # Event-sourced triggers and webhook push

  @unit
  Scenario: The scheduled traffic pass reconciles every organisation the registry holds
    Given two organisations hold registry entries
    When the traffic pass runs
    Then the registry reconciles both organisations

  @unit
  Scenario: The daily traffic pass also reaches organisations the registry does not hold
    Given an organisation that holds no registry entry yet
    When the first traffic pass of a UTC day runs
    Then the pass walks every organisation and reconciles that one too
    And later passes that day walk only the organisations the registry holds

  @unit
  Scenario: A recorded agent change reconciles the agent's organisation
    Given the agent module records that an agent in the project changed
    When governance's subscriber handles the fact
    Then the registry reconciles the project's organisation

  @unit
  Scenario: A recorded agent archive reconciles the agent's organisation
    Given the agent module records that an agent in the project was archived
    When governance's subscriber handles the fact
    Then the registry reconciles the project's organisation

  @unit
  Scenario: A burst of changes to one project's agents settles into one reconcile
    Given the agent module records three changes to agents in the same project within the settle window
    When governance's subscriber handles the facts
    Then the registry reconciles the project's organisation once

  @unit
  Scenario: A traffic pass prunes its own bookkeeping older than a week
    When a scheduled traffic pass runs
    Then the registry reconciles the organisations it holds
    And the pass's dispatched outbox rows older than seven days are deleted
    And a failed prune leaves the pass successful

  @unit
  Scenario: A listing run reconciles the organisation's registry
    Given an ingestion source listed its agents
    When the listing is saved
    Then the registry reconciles the organisation

  @unit
  Scenario: A registry reconcile that fails after a listing leaves the listing saved
    Given an ingestion source listed its agents
    When the registry reconcile after the listing fails
    Then the listing is still saved and the failure is logged

  @unit
  Scenario: Every new event is pushed once to each subscribed webhook endpoint
    Given the organisation has an active endpoint subscribed to "governance.agent.*" and one subscribed only to "gateway.*"
    When the registry appends a "governance.agent.registered" event
    Then one delivery intent is recorded for the subscribed endpoint keyed by the event id
    And none is recorded for the other endpoint

  @unit
  Scenario: An event whose push was not recorded is pushed by the next reconcile
    Given an event was appended but its delivery intents were never recorded
    When the registry reconciles again with nothing changed
    Then the event's delivery intents are recorded

  @unit
  Scenario: The delivery handler asks the webhook module with the event's idempotency key
    Given a delivery intent for an event and an endpoint
    When the worker runs the intent
    Then WebhookApi.requestDelivery is asked once with the event type and the key "agent-registry:<event id>:<endpoint id>"

  # REST reads

  @integration
  Scenario: The registry lists the organisation's entries a page at a time
    Given the registry holds three entries
    When GET /api/governance/registry/agents is asked with limit 2
    Then the response holds two entries and a next cursor
    And asking again with that cursor returns the third entry

  @integration
  Scenario: The registry filters entries updated since an instant
    Given one entry updated yesterday and one updated today
    When GET /api/governance/registry/agents is asked with updated_since this morning
    Then only today's entry is returned

  @unit
  Scenario: A listing cursor this registry never returned is refused
    Given a cursor whose timestamp does not parse
    When the registry list is asked with it
    Then the request is refused as a validation error

  @integration
  Scenario: An unknown registry id is a 404
    When GET /api/governance/registry/agents/unknown is asked
    Then the response is 404 with code "agent_registry_entry_not_found"

  @integration
  Scenario: The event feed is read after a cursor in order
    Given the registry appended three events
    When GET /api/governance/registry/events is asked after the first event's sequence
    Then the second and third events are returned in order

  @integration
  Scenario: A key without governance:view is refused
    Given an organisation API key without governance:view
    When GET /api/governance/registry/agents is asked
    Then the response is 403

  # ARD

  @unit
  Scenario: An entry maps to an ARD entry with a urn:air identifier and an inline agent card
    Given an entry "Support bot" at version 3 in organisation "org_acme"
    When the ARD manifest is built for publisher "app.langwatch.ai"
    Then the ARD entry identifier is "urn:air:app.langwatch.ai:org_acme:agent:<entry id>"
    And its type is "application/agent-card+json" and its version is "3"
    And its data carries the tools with their input schemas and the instructions

  @unit
  Scenario: Removed entries are left out of the ARD manifest
    Given one active entry and one removed entry
    When the ARD manifest is built
    Then only the active entry is listed

  @unit
  Scenario: ARD search ranks entries by the query text and applies filters
    Given entries "Billing assistant" and "Support bot"
    When ARD search asks for text "billing" with filter source ["langwatch"]
    Then "Billing assistant" is the first result with a score between 0 and 100

  @unit
  Scenario: ARD search treats a filter on an inherited property as no match
    Given an entry "Support bot"
    When ARD search asks for text "support" with filters on "toString" and "data.constructor"
    Then no result is answered and the search does not fail

  @unit
  Scenario: ARD search with no text is refused
    When ARD search is asked without query text
    Then the request body is refused by its schema
