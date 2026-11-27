Feature: A write leaves out what the caller leaves out
  As an integrator updating a resource through REST, tRPC, the MCP server, the SDK or the CLI
  I want a field I leave out of an update to keep its stored value
  So that changing one field never resets the others to their defaults

  # Zod 4 applies a `.default()` even under `.optional()` or `.partial()`, so a
  # field built that way is never absent after parsing. An update that omits it
  # writes the default over the stored value. An update schema uses a variant
  # with no default instead.

  @unit
  Scenario: An optional write field carries no default
    Given every tRPC mutation input and every REST write body the processes install
    When each input is walked for a default nested under an optional
    Then none is found
