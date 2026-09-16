Feature: The MCP server's boot graph stays lazy

  The server is published as `@langwatch/mcp-server` and started through its
  `langwatch-mcp-server` binary, so an editor or agent pays its startup cost on
  every session. It registers roughly a hundred tools, and a session calls a
  handful of them.

  So the tool handlers are reached with `await import(...)` inside the callback
  that needs them, rather than imported at the top of the module that registers
  them. That keeps the modules a session never touches -- including the
  generated evaluator catalogue, which is two thousand lines on its own -- out
  of the graph Node evaluates before the server answers anything.

  This is the same trade the published TypeScript SDK's command line makes, and
  like that one it is only true while something checks it: a single lazy import
  rewritten as a top-level one puts the whole tool surface back on the boot
  path, and nothing else in the suite would notice.

  @unit
  Scenario: The generated evaluator catalogue is not on the boot path
    Given the module that creates the server
    When its static imports are followed as far as they reach
    Then the generated evaluator catalogue is not among them

  @unit
  Scenario: Tool handlers are not imported at the top of the registration module
    Given the module that creates the server
    When its static imports are followed as far as they reach
    Then only the handful of handlers it registers eagerly are among them
    And every other handler is reached through a dynamic import instead

  @unit
  Scenario: A handler moved onto the boot path is reported
    Given a tool handler that the registration module reaches lazily today
    When it is rewritten as a top-level import
    Then the boot graph check fails and names the handler
