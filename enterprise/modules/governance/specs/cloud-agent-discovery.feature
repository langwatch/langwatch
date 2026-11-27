Feature: Cloud agent discovery with shadow and dormant agents

  A governance team connects its AWS accounts, its Google Cloud projects and any agent registry that
  publishes Agentic Resource Discovery (ARD v0.91) as governance sources. Each source lists the
  agents it holds on its own schedule: Bedrock Agents and Bedrock AgentCore runtimes per configured
  region, Vertex AI Agent Engine reasoning engines per project and location, and the urn:air
  entries of an ARD registry. Every listed agent enters the agent registry with a stable id, its
  platform, model, owner and tags. The registry then joins what sources list with what traces show:
  a listed agent with traffic is governed, a traced agent no source lists is shadow, and a listed
  agent with no traffic for the organisation's dormancy window (30 days unless changed) is dormant.
  A new shadow agent sends `governance.agent.flagged_shadow` to the organisation's webhooks and a
  push alert to its admins. Sources and the dormancy window are Enterprise features under
  ingestionSources:manage; the inventory reads under governance:view.
  Docs: docs/ai-governance/cloud-agent-discovery.mdx

  Background:
    Given an Enterprise organisation with a governance project and an admin holding ingestionSources:manage

  # AWS

  @unit
  Scenario: A Bedrock agent listed in a region becomes a sighting keyed by its ARN
    Given an AWS source for regions "eu-west-1" and "us-east-1" signing with an AWS connection
    And Bedrock in "eu-west-1" lists agent "AGENT12345" named "refund-bot" on model "anthropic.claude-sonnet-5" with tag "owner" = "payments"
    When the source lists its agents
    Then one sighting is recorded with id "arn:aws:bedrock:eu-west-1:111122223333:agent/AGENT12345"
    And the sighting names platform "aws_bedrock", model "anthropic.claude-sonnet-5", owner "payments" and the agent's last update
    And the agent id and its alias ids and ARNs are the ids a trace may carry for it

  @unit
  Scenario: A Bedrock AgentCore runtime becomes a sighting keyed by its ARN
    Given an AWS source for region "us-east-1"
    And AgentCore in "us-east-1" lists runtime "support_runtime-abc123" with its ARN
    When the source lists its agents
    Then one sighting is recorded with the runtime ARN as its id and platform "aws_agentcore"

  @unit
  Scenario: The AWS listing follows every page in every region
    Given Bedrock answers ListAgents in two pages and AgentCore answers ListAgentRuntimes in two pages
    When the source lists its agents
    Then every agent of every page is recorded

  @unit
  Scenario: An AWS region that refuses fails the whole listing and records nothing
    Given an AWS source for regions "eu-west-1" and "us-east-1"
    And Bedrock in "us-east-1" answers 403 AccessDeniedException
    When the source lists its agents
    Then the listing is refused as "unauthorized" and no sighting is recorded

  @unit
  Scenario: An AWS source whose connection holds no credentials refuses as not configured
    Given an AWS connection with neither an access key pair nor a role to assume
    When the source lists its agents
    Then the listing is refused as "not_configured"

  @integration
  Scenario: An AWS source naming an AWS connection of another organisation refuses as not configured
    Given an AWS source whose connection id belongs to another organisation
    When the source lists its agents
    Then the listing is refused as "not_configured"

  @unit
  Scenario: An AWS source needs a connection and at least one valid region
    When an admin saves an AWS source with region "not-a-region" and no connection
    Then the save is refused with field errors on the regions and the connection

  # Google Cloud

  @unit
  Scenario: A Vertex AI reasoning engine becomes a sighting keyed by its resource name
    Given a Google Cloud source for project "acme-ml" in "europe-west4" with a service account key
    And Vertex AI lists reasoning engine "projects/acme-ml/locations/europe-west4/reasoningEngines/42" named "claims-agent" with label "owner" = "claims"
    When the source lists its agents
    Then one sighting is recorded with the resource name as its id and platform "gcp_vertex"
    And the sighting names owner "claims", its labels and its update time
    And the resource name and the engine id "42" are the ids a trace may carry for it

  @unit
  Scenario: The Google Cloud listing signs in with the service account and follows page tokens
    Given Vertex AI answers reasoningEngines.list in two pages
    When the source lists its agents
    Then the service account's signed assertion is exchanged for an access token once
    And every engine of both pages is recorded

  @unit
  Scenario: A service account key that does not parse refuses as not configured
    Given a Google Cloud source whose stored key is not a service account JSON
    When the source lists its agents
    Then the listing is refused as "not_configured"

  @unit
  Scenario: A token exchange the identity service refuses reads as unauthorized
    Given Google's token endpoint answers 400 invalid_grant
    When the source lists its agents
    Then the listing is refused as "unauthorized"

  @unit
  Scenario: The service account key is sealed and never read back
    When an admin saves a Google Cloud source with a service account key
    Then the key is stored sealed under the source's credentials
    And reading the source back shows the key as set without its value

  # ARD registry

  @unit
  Scenario: An ARD registry's entries become sightings keyed by their urn:air identifiers
    Given an ARD source for "registry.acme.test"
    And "https://registry.acme.test/.well-known/ard.json" serves a v0.91 manifest with entry "urn:air:registry.acme.test:agent:triage"
    When the source lists its agents
    Then one sighting is recorded with id "urn:air:registry.acme.test:agent:triage" and platform "ard"

  @unit
  Scenario: An ARD registry with a search endpoint is read page by page
    Given an ARD source naming a search endpoint
    And the search answers two pages joined by a page token
    When the source lists its agents
    Then the entries of the manifest and of both search pages are recorded once each

  @unit
  Scenario: A manifest of another ARD version refuses as malformed
    Given "https://registry.acme.test/.well-known/ard.json" serves specVersion "0.80"
    When the source lists its agents
    Then the listing is refused as "malformed_response"

  @unit
  Scenario: An ARD source address that points inside the network is refused
    When an admin saves an ARD source for "http://169.254.169.254"
    Then the save is refused by the outbound address fence

  # Event-sourced sync

  @unit
  Scenario: A cloud source lists its agents on its own schedule
    Given an AWS source with schedule "0 * * * *"
    When its scheduled run wakes
    Then the source's agents are listed and the outcome is recorded on the source's run
    And no usage pull is attempted for it

  @integration
  Scenario: A listing that no longer names an agent marks it gone
    Given an AWS source that listed agents "A" and "B"
    When the next listing names only "A"
    Then "B" is marked gone and its registry entry is removed with a "governance.agent.removed" event

  @integration
  Scenario: An agent that comes back after it was marked gone is active again
    Given agent "B" was marked gone
    When a later listing names "B" again
    Then "B" is active and its registry entry is versioned back to active

  @integration
  Scenario: An agent another source still lists stays when one source stops listing it
    Given two sources that both listed agent "A"
    When the first source's next listing names no agents
    Then "A" stays active because the second source still lists it
    And "A" is marked gone only once the second source stops listing it too

  @integration
  Scenario: A refused listing marks nothing gone
    Given an AWS source that listed agents "A" and "B"
    When the next listing is refused
    Then both stay as they were

  @integration
  Scenario: Listing the same agents twice records no change
    Given an AWS source that listed agent "A"
    When the source lists "A" again unchanged
    Then the registry appends no event

  # Shadow and dormant

  @unit
  Scenario: A listed agent whose traces carry its id is governed
    Given a listed Bedrock agent "AGENT12345"
    And traces in the dormancy window carry gen_ai.agent.id "AGENT12345"
    When the registry reconciles
    Then the entry is neither shadow nor dormant

  @unit
  Scenario: A traced agent no source lists is flagged shadow and announced once
    Given traces name an agent "pricing-bot" with gen_ai.agent.id "rogue-7" that no source lists
    When the registry reconciles twice
    Then one entry flagged shadow is registered
    And exactly one "governance.agent.flagged_shadow" event is appended

  @unit
  Scenario: A traced agent carrying a listed resource name is not shadow
    Given a listed reasoning engine "projects/acme-ml/locations/europe-west4/reasoningEngines/42"
    And traces carry gen_ai.agent.id "42"
    When the registry reconciles
    Then no shadow entry is built for it

  @unit
  Scenario: A listed agent with no traffic for the dormancy window is dormant
    Given a listed AgentCore runtime created 90 days ago with no trace in the last 30 days
    When the registry reconciles
    Then the entry is dormant and a "governance.agent.versioned" event records it

  @unit @integration
  Scenario: An entry stored before dormancy existed turns dormant without a new version
    Given a registry entry stored by a release that did not store the dormant flag
    And the agent has had no traffic for the dormancy window
    When the registry reconciles
    Then the entry is dormant at the same version
    And the registry appends no event

  @unit
  Scenario: A listed agent younger than the dormancy window is not dormant
    Given a listed Bedrock agent created 3 days ago with no traffic
    When the registry reconciles
    Then the entry is not dormant

  @unit
  Scenario: The organisation's dormancy window decides when an agent is dormant
    Given the organisation set its dormancy window to 7 days
    And a listed agent created 90 days ago last traced 10 days ago
    When the registry reconciles
    Then the entry is dormant

  @unit
  Scenario: A dormant agent that gets traffic again is governed
    Given a dormant listed agent
    When its id appears in traces and the registry reconciles
    Then the entry is no longer dormant

  @integration
  Scenario: The dormancy window is read and saved per organisation
    Given an organisation that never set a dormancy window
    When an admin reads the registry settings
    Then the dormancy window is 30 days
    When the admin saves 14 days
    Then the next read answers 14 days

  @integration
  Scenario: A dormancy window outside 1 to 365 days is refused
    When an admin saves a dormancy window of 0 days
    Then the save is refused as a validation error

  @integration
  Scenario: Saving the dormancy window needs ingestionSources:manage
    Given a member holding only governance:view
    When the member saves a dormancy window
    Then the request is refused as forbidden

  # Alerts

  @unit
  Scenario: A new shadow agent is pushed to every webhook subscribed to governance.agent.*
    Given an endpoint subscribed to "governance.agent.*"
    When a reconcile flags a new shadow agent
    Then one "governance.agent.flagged_shadow" delivery is requested for the endpoint

  @unit
  Scenario: A new shadow agent alerts each organisation admin once
    Given an organisation with two admins and one member
    When a reconcile flags a new shadow agent
    Then one push alert is requested per admin, keyed by the event and the admin
    And the member gets no alert

  @unit
  Scenario: A silent baseline flags shadow agents without alerting
    Given an organisation the registry has not reconciled yet whose traces name a shadow agent
    When its first reconcile runs
    Then the shadow entry is registered and no push alert or webhook delivery is requested

  # Inventory

  @unit
  Scenario: The inventory shows each agent's posture
    Given a governed, a shadow and a dormant agent in the registry
    When the Agents page is read
    Then each row carries posture "governed", "shadow" or "dormant"
    And a listed agent's row names the model its source lists

  @unit
  Scenario: The inventory filters by posture and by cloud source
    Given rows from AWS, Google Cloud, an ARD registry and traces
    When the posture filter is set to "shadow"
    Then only the shadow rows are shown
    And the source filter offers AWS, Google Cloud and ARD registry

  @integration
  Scenario: The registry list filters by posture
    Given the registry holds a governed, a shadow and a dormant entry
    When GET /api/governance/registry/agents is asked with posture "dormant"
    Then only the dormant entry is returned

  # Source form

  @integration
  Scenario: The AWS source form refuses a region code before it adds it
    When an admin types "not-a-region" in the regions of an AWS source
    Then the form says to use a region code such as eu-west-1 and adds nothing
    When the admin types "eu-north-1" and picks the suggested "us-east-1"
    Then both are added to the regions

  @integration
  Scenario: An AWS source holding a value that is not a region code says to remove it
    Given an AWS source whose regions hold "mars-1"
    When an admin opens its form
    Then the form says "mars-1" is not a region code and must be removed to save

  @integration
  Scenario: The Google Cloud source form adds and removes project rows
    When an admin adds a second project row with no location
    Then that row asks for a project id and a location
    When the admin removes the second row
    Then only the first project and location remain

  @integration
  Scenario: The AWS connection picker lists the organisation's connections
    Given the organisation holds a key pair connection and a role connection
    When an admin opens the AWS connection picker
    Then each connection is offered by name with its role or the key it ends with

  @integration
  Scenario: The AWS connection picker says when the connections did not load and reads them again
    Given the AWS connections read fails
    When the admin asks to try again
    Then the connections are read again and the picker is offered

  @integration
  Scenario: The AWS connection picker adds a connection without leaving the form and picks it
    When an admin adds an AWS connection from the picker
    Then the new connection is created and picked for the source
    And cancelling the new connection leaves the source's connection unchanged

  @integration
  Scenario: The dormancy window control says when the window did not load and reads it again
    Given the registry settings read fails
    When the admin asks to retry
    Then the saved dormancy window is shown

  @integration
  Scenario: The dormancy window control opens with the saved window and saves a new one
    Given the organisation saved a dormancy window of 30 days
    When an admin opens the dormancy window control and saves 14 days
    Then the control shows 14 days and the agents are read again

  @integration
  Scenario: The dormancy window control refuses a window outside 1 to 365 days
    When an admin types 400 days in the dormancy window control
    Then the control asks for a whole number from 1 to 365 and sends nothing

  # Test connection

  @integration
  Scenario: Testing a source's connection lists without recording
    Given an AWS source whose regions answer three agents
    When an admin tests the connection
    Then the answer says three agents were found and no sighting is recorded

  @integration
  Scenario: A test connection that the provider refuses answers the refusal reason
    Given a Google Cloud source whose token exchange is refused
    When an admin tests the connection
    Then the answer is refused with reason "unauthorized"
