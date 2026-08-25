# See ../adrs/001-package-boundary.md

Feature: Agents package boundary
  As an Agents feature maintainer
  I want one portable contract and one implementation behind internal RPC and legacy REST
  So that agent definitions can move out of the app without duplicating behaviour

  @architecture @typecheck
  Scenario: Agent contract values are portable
    Given a browser or another feature needs an agent definition
    When it imports @langwatch/agent-contract
    Then agent types, config schemas, commands, queries and errors are available
    And the dependency graph contains no Prisma, React, app alias or server implementation

  @architecture @typecheck
  Scenario: Agents is the strict layout reference feature
    Given Agents declares layoutVersion 0 in feature.json
    Then contract artifacts use subject.artifact.ts names
    And the server uses services, repositories, ports and api surface directories
    And concrete adapters use technology.subject.artifact.ts names
    And service, repository and API behaviour is owned by classes
    And PrismaAgentAdapter binds the private repository without AgentService importing it

  @unit @agents
  Scenario: Persisted rows are mapped into contract agents
    Given a Prisma agent row contains a supported agent type and config
    When the Agents repository reads the row
    Then it validates the config using the Agents contract schema
    And it returns an Agents contract value
    And no generated Prisma type crosses the repository boundary

  @unit @agents
  Scenario: Invalid config is rejected before persistence
    Given a create or update command whose config does not match its agent type
    When AgentService handles the command
    Then it throws InvalidAgentConfigError with the declared agent type
    And the repository is not asked to persist the command

  @unit @agents
  Scenario: A missing singular agent read throws
    Given the repository cannot find the requested agent and project
    When AgentService reads that agent
    Then it throws AgentNotFoundError containing the agent and project IDs
    And no nullable successful result crosses the service boundary

  @integration @rpc
  Scenario: Internal RPC invokes the injected agent service
    Given an authenticated product user may manage agents in a project
    When the user creates an agent through the internal RPC interface
    Then the package-owned router invokes AgentService once
    And it returns an Agents contract response

  @integration @rest
  Scenario: Legacy REST forwards to the same agent service
    Given a valid project API key
    When a client creates an agent through the legacy REST interface
    Then the REST adapter invokes the same AgentService command as internal RPC
    And the response preserves the documented REST status and shape
    And the REST adapter does not call Prisma or the internal HTTP server

  @integration @rest
  Scenario: Legacy REST is documented as deprecated
    Given the Agents REST compatibility interface is mounted
    When the OpenAPI document is generated
    Then every legacy Agents operation is marked deprecated
    And its documentation directs new clients to the Agents RPC interface
    And the legacy operation remains functional

  @unit @openapi @typecheck
  Scenario: Contract schemas define both API interfaces
    Given the Agents contract owns Zod request, response and problem schemas
    When the RPC and legacy REST adapters are compiled
    Then RPC validates and infers its values from those schemas
    And REST validation and OpenAPI models use the same schemas
    And the contract imports Zod 4 from zod rather than zod/v3
    And the REST adapter uses Standard Schema rather than a Hono-specific Zod adapter
    And each persisted agent type has a type-specific create schema

  @integration @agents
  Scenario: RPC and REST reject the same invalid agent config
    Given an agent config is invalid for its declared type
    When the config is submitted through either supported API interface
    Then both interfaces expose the same domain failure
    And each transport maps it to its own stable error representation

  @integration @authorization
  Scenario: Agent operations remain project scoped
    Given an agent belongs to project A
    And the caller is authorized only for project B
    When the caller reads or changes the agent through either interface
    Then no agent data is returned or changed

  @integration @agents
  Scenario: Archived agents are absent from ordinary reads
    Given an agent has been archived
    When the project lists or reads agents through either interface
    Then the archived agent is absent

  @unit @agents
  Scenario: Linked workflow behaviour uses an injected capability
    Given an agent operation needs to read, copy or archive a linked workflow
    When AgentService performs the operation
    Then it invokes the workflow capability supplied by the composition root
    And Agents server imports no Workflows server or repository implementation

  @architecture @web @typecheck
  Scenario: Agents web is browser safe
    Given the app composes an Agents screen
    Then the screen reaches behaviour through an injected browser client
    And it depends on Agents contract and the design system
    And it imports no Agents server, Prisma, Node runtime or app source

  @web @http-agent
  Scenario: HTTP editor preserves stored and default scenario mappings
    Given an existing HTTP agent has persisted scenario mappings
    When its editor opens
    Then the persisted mappings are shown
    When the persisted mapping set is empty
    Then the app-supplied default mappings are shown instead

  @web @http-agent
  Scenario: HTTP request testing preserves the compatibility result
    Given an HTTP agent editor has a configured endpoint and headers
    When the user tests the request
    Then the app executes it for the current project
    And only header keys and values cross the transport boundary
    And the editor receives the established response, output, error, status, duration, header, rendered body, and warning fields

  @architecture @registration
  Scenario: Each runtime installs only its Agents adapter
    Given no Agents installer has been called
    Then importing an Agents package registers no route or background work
    When the internal server installs Agents
    Then only the RPC fragment is mounted
    When the public API installs Agents
    Then only the legacy REST adapter is mounted

  @architecture
  Scenario: Coding-agent observability remains a separate feature
    Given the Agents package is extracted
    Then coding-agent sessions, projections, trace normalization and pull-request usage do not move into it
