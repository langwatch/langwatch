# See ../../../dev/docs/adr/105-mcp-access-via-discover-catalogues.md
# See ../../../packages/api/specs/api-discovery.feature (the catalogue contract
# these tools are projected from)
Feature: MCP tools from the rpc.discover catalogues

  As an agent connected to the LangWatch MCP server
  I want every catalogued RPC operation to be callable as an MCP tool
  So that a new documented endpoint is MCP-accessible the moment it ships,
  with no per-service tool work

  Background:
    Given the platform serves the two-level rpc.discover contract
    And the MCP server is configured with an endpoint and an API key

  @unit
  Scenario: Tools are discovered from the root index and the service catalogues
    Given the root index lists a "things" service with its catalogue URL
    And that catalogue carries the operation "things.create"
    When the MCP server starts
    Then a tool for "things.create" is registered
    And no tool is registered for an operation no catalogue carries

  @unit
  Scenario: Tool names map dots to underscores
    When the operation "things.create" becomes a tool
    Then the tool is named "things_create"

  @unit
  Scenario: A tool name collision fails discovery
    Given two operations whose dotted names map to the same tool name
    When the MCP server starts
    Then startup fails naming both operations
    And neither silently shadows the other

  @unit
  Scenario: A tool's input schema comes from the catalogue
    Given the operation "things.create" carries an input JSON Schema
    When it becomes a tool
    Then the tool's advertised input schema carries that schema's fields,
      types and descriptions

  @unit
  Scenario: An operation with null input becomes a no-argument tool
    Given the operation "things.list" carries a null input
    When it becomes a tool
    Then the tool takes no arguments

  @unit
  Scenario: Calling a tool POSTs the arguments to the operation's path
    Given the tool "things_create" from the catalogue
    When the agent calls it with arguments
    Then the adapter POSTs those arguments as the JSON body to the operation's
      documented path
    And the call carries the configured LangWatch API key
    And the operation's result is the tool's result

  @unit
  Scenario: A failed operation call surfaces the platform's error
    Given the operation answers a named HandledError
    When the agent calls the tool
    Then the tool fails with the platform's error code and message

  @unit
  Scenario: A catalogue that cannot be fetched fails the startup
    Given the root index or a service catalogue is unreachable
    When the MCP server starts
    Then startup fails with a clear error
    And the server does not serve a silently empty tool list
