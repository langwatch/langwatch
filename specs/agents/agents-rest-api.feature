Feature: Agent REST API
  As an API consumer (SDK, CLI, or AI agent)
  I want full CRUD access to agents via REST endpoints
  So that I can programmatically manage agent definitions without the UI

  Background:
    Given a project with a valid API key in the X-Auth-Token header

  # ── List Agents ──────────────────────────────────────────────

  @integration
  Scenario: List agents returns paginated non-archived agents
    Given the project has 3 agents and 1 archived agent
    When I call GET /api/agents
    Then I receive a paginated response with 3 agents
    And each agent includes id, name, type, config, createdAt, and updatedAt
    And the archived agent is not included

  @integration
  Scenario: List agents with page and limit parameters
    Given the project has 15 agents
    When I call GET /api/agents?page=2&limit=5
    Then I receive 5 agents from the second page
    And the response includes pagination metadata with total count

  @integration
  Scenario: List agents returns empty array for project with no agents
    When I call GET /api/agents
    Then I receive a paginated response with 0 agents

  # ── Create Agent ─────────────────────────────────────────────

  @integration
  Scenario: Create an agent with name, type, and config
    When I call POST /api/agents with name "My Agent", type "signature", and a valid config
    Then a new agent is created with status 201
    And the response includes the agent id, name, type, and config

  @integration
  Scenario: Create an agent enforces plan limits
    Given the project has reached its agent plan limit
    When I call POST /api/agents with valid agent data
    Then the request fails with 403 Forbidden
    And the error indicates the agent limit has been reached

  @integration
  Scenario: Create an agent validates config against type schema
    When I call POST /api/agents with type "signature" and an invalid config
    Then the request fails with 422 Unprocessable Entity

  @integration
  Scenario: Create an agent requires a name
    When I call POST /api/agents without a name
    Then the request fails with 422 Unprocessable Entity

  @integration
  Scenario: Create an agent requires a type
    When I call POST /api/agents without a type
    Then the request fails with 422 Unprocessable Entity

  # ── Get Single Agent ─────────────────────────────────────────

  @integration
  Scenario: Get an agent by id
    Given an agent with id "agent_abc123" exists
    When I call GET /api/agents/agent_abc123
    Then I receive the agent details
    And the response includes id, name, type, and config

  @integration
  Scenario: Get agent returns 404 for non-existent id
    When I call GET /api/agents/agent_doesnotexist
    Then the request fails with 404 Not Found

  # ── Update Agent ─────────────────────────────────────────────

  @integration
  Scenario: Update an agent name
    Given an agent with id "agent_abc123" exists
    When I call PATCH /api/agents/agent_abc123 with name "Updated Name"
    Then the agent is updated
    And the response reflects the updated name

  @integration
  Scenario: Update an agent config
    Given an agent with id "agent_abc123" exists
    When I call PATCH /api/agents/agent_abc123 with a new config
    Then the agent config is updated

  @integration
  Scenario: Update a non-existent agent returns 404
    When I call PATCH /api/agents/agent_ghost with name "Whatever"
    Then the request fails with 404 Not Found

  # ── Delete (Archive) Agent ───────────────────────────────────

  @integration
  Scenario: Delete an agent archives it
    Given an agent with id "agent_abc123" exists
    When I call DELETE /api/agents/agent_abc123
    Then the agent is soft-deleted with an archivedAt timestamp
    And subsequent GET /api/agents/agent_abc123 returns 404

  @integration
  Scenario: Delete a non-existent agent returns 404
    When I call DELETE /api/agents/agent_nope
    Then the request fails with 404 Not Found

  # ── Authentication ─────────────────────────────────────────────

  @integration
  Scenario: Request without API key returns 401
    When I call any agent endpoint without X-Auth-Token header
    Then the request fails with 401 Unauthorized

  @integration
  Scenario: Request with invalid API key returns 401
    When I call any agent endpoint with an invalid X-Auth-Token
    Then the request fails with 401 Unauthorized
