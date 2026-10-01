@agent
Feature: HTTP agent credentials
  A third party's token typed into an HTTP agent is a project secret, not agent data.

  @integration
  Scenario: A token typed into an HTTP agent is stored as a project secret and never read back
    Given an HTTP agent saved with a bearer token typed inline
    When the agent is created
    Then the token is stored as a project secret named after the agent's id and the field
    And the agent keeps only the {{ secrets.NAME }} reference
    And no read of the agent answers the token

  @integration
  Scenario: A blank token on a saved HTTP agent keeps its reference
    Given a saved HTTP agent holding a secret reference
    When it is saved again with the token left blank
    Then the agent still holds the reference and no further secret is stored

  @unit
  Scenario: An HTTP agent's secrets are named from its id
    Given an HTTP agent saved with a token and a credential header
    When the agent is created
    Then each secret is named HTTP_<agent id>_<field>, never after the agent's name

  @unit
  Scenario: One test decides which headers are credentials
    Given a header named Authorization, X-Api-Key, Cookie or Proxy-Authorization, or containing key, token, secret, auth or password
    When an HTTP node or agent is saved, read or traced
    Then that header is stored as a secret, blanked on a read and redacted in a trace
    And any other header is kept and answered as typed

  @unit
  Scenario: Two saves storing the same new token at once both succeed
    Given two saves race to store a newly typed token under the same secret name
    When the second one finds the name taken
    Then it re-reads the project's secrets and reuses the name or takes the next number

  @unit
  Scenario: A copy into another project arrives with blank credentials
    Given an HTTP agent or a graph with HTTP nodes holding credentials or secret references
    When it is copied, pushed or synced into another project
    Then every credential arrives blank for the user to enter again
    And an agent copy keeps its own credentials where its address is unchanged

  @integration
  Scenario: An agent read never answers a credential over REST
    Given an HTTP agent still holding credentials typed inline
    When it is listed or read through /api/v1/agents or /api/agents
    Then every credential value is blank and every other header is answered as typed

  @unit
  Scenario: A credential typed into an HTTP agent is bound to the agent's address
    Given an HTTP agent saved with a token typed inline and a fixed address
    When the agent is created or updated
    Then the token's project secret is bound to the address's scheme, host and port
    And a secret holding the same token for another address is not reused
    And an address with no fixed origin leaves the secret unbound

  @unit
  Scenario: An agent test refuses to send a bound secret to another address
    Given a project secret bound to the address an HTTP agent was saved for
    When a test call would send that secret to another scheme, host or port
    Then the call is refused with agent_stored_credentials_destination_mismatch before any request
