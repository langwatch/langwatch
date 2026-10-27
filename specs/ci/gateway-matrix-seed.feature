Feature: The live gateway matrix seeds its own control plane
  As the team that ships the AI gateway
  I want every gateway-matrix run to mint its own organization, project, model providers and virtual keys
  So that the live cells run against the fresh stack they boot, instead of skipping on keys no database holds

  # These scenarios describe the seed step of .github/workflows/gateway-matrix.yaml.
  # The seed is `go run ./cmd/matrixseed` (logic in tools/matrixseed), bound by
  # tools/matrixseed/*_test.go against a stub control plane. It drives only the
  # public REST routes, starting from the instance administrator key the run
  # generates: POST /api/v1/organizations, POST /api/v1/projects,
  # PUT /api/v1/model-providers/{provider} and POST /api/gateway/v1/virtual-keys.
  # Whether a live provider answers is the matrix's own question, not the seed's:
  # the run itself is @unimplemented here and proved by the first run on main.

  Background:
    Given the matrix job has booted an empty control plane with a per-run instance administrator key

  @unit
  Scenario: The seed provisions one organization and one project through the public API
    When the seed runs
    Then it provisions one organization with the instance administrator key
    And it creates one project in that organization's team with the organization's admin key
    And it exports the project's service key as LW_PROJECT_API_KEY

  @unit
  Scenario: Each provider with credentials gets one model provider and one virtual key
    Given the job holds credentials for OpenAI, Anthropic, Gemini, Azure, Vertex, Voyage and ElevenLabs
    When the seed runs
    Then it stores one model provider per provider in the project, carrying that provider's credentials
    And it mints one virtual key per provider that may use only that provider's model provider
    And it exports each virtual key under the TEST_VK_ variable its matrix cells read

  @unit
  Scenario: The Bedrock model provider carries no access key
    Given the job holds an AWS session from its credentials step
    When the seed runs
    Then the Bedrock model provider carries the region and no access key, secret or session token
    And the gateway signs Bedrock calls with the job's own AWS session through the default credential chain

  @unit
  Scenario: A provider with no credentials is skipped, not failed
    Given the job holds no credentials for a provider
    When the seed runs
    Then it stores no model provider and mints no virtual key for that provider
    And its TEST_VK_ variable stays unset, so its cells skip with the variable's name
    And the seed still exits successfully

  @unit
  Scenario: A control plane refusal for one provider still seeds the others, and fails the step
    Given the job holds credentials for OpenAI and Anthropic
    And the control plane refuses to store the Anthropic model provider
    When the seed runs
    Then the OpenAI virtual key is exported
    And the seed exits with a failure that names Anthropic and the control plane's status

  @unit
  Scenario: A failed bootstrap exports nothing
    Given the control plane refuses the instance administrator key
    When the seed runs
    Then it exports no variable
    And it exits with a failure naming the refused call

  @unit
  Scenario: Every exported secret is masked before it is written
    When the seed exports a virtual key or the project key
    Then the run log carries an add-mask command for the value before the value reaches the job environment
    And the value itself is never printed

  @unit
  Scenario: A refused request never prints a submitted secret
    Given the control plane refuses a request and echoes what it received
    When the seed reports the refusal
    Then the model-provider request's response body is never printed
    And any other request's snippet has the submitted secrets removed, raw and JSON-escaped

  @unit
  Scenario: The Azure api version is stored when the job sets it
    Given the job holds Azure credentials and an api version
    When the seed runs
    Then the Azure model provider carries AZURE_OPENAI_API_VERSION
    And an empty api version is not stored

  @unit
  Scenario: The gateway and matrix run only once the seed has bootstrapped
    Given the seed provisions the organisation and the project
    When it has written the project's exports
    Then it sets the step output bootstrapped=true
    And when the bootstrap fails it exports nothing and sets no output

  @unit
  Scenario: A seed create carries no Idempotency-Key
    Given the seed never retries a request
    When it creates the organization and the project
    Then neither request carries an Idempotency-Key

  @unit
  Scenario: The Vertex cache cell gets a token minted from the service-account key
    Given the job holds the Vertex service-account key
    When the seed runs
    Then it exchanges a signed assertion at the key's token endpoint and exports VERTEX_ACCESS_TOKEN, masked
    And a refused exchange exports no token and warns, so the cell skips

  @unimplemented
  Scenario: A run on main drives every cell with credentials against the seeded stack
    Given the matrix secrets hold provider credentials
    When gateway-matrix runs on main
    Then every cell whose provider has credentials sends a real request through the gateway
    And its trace lands in the seeded project with a cost
