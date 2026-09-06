Feature: A dogfooding browser does not outlive its agent
  As a developer whose machine runs many agent sessions that drive a browser
  I want the Playwright MCP and its Chrome to go down when their session dies
  So that killed sessions stop accumulating orphaned browsers

  # Observed: 20 orphaned Chromes and 7.4 GB of their profiles under
  # ~/Library/Caches/ms-playwright-mcp, each left by a dogfooding session that
  # was long gone. The chain has two breaks: a hard-killed session cannot
  # signal the MCP it spawned (it reparents to launchd and keeps serving
  # nobody), and the Chrome the MCP launched detaches from its parent's fate
  # on purpose, so even the MCP dying cleanly is not always enough.
  #
  # macOS has no die-with-parent, so the MCP watches for itself:
  # dev/scripts/playwright-mcp.sh loads dev/scripts/die-with-parent.cjs into
  # the MCP's node process, which polls its parent pid. On orphaning it
  # SIGTERMs its direct children (the browser) and then itself, which runs the
  # MCP's own shutdown handlers - the same path a clean disconnect takes.

  @unit
  Scenario: The MCP and its browser go down when their session dies
    Given an MCP-shaped process with a child, spawned by a session
    When the session is killed without signalling anything
    Then the process notices it was orphaned and shuts down
    And its child is taken down with it

  @unit
  Scenario: A living session keeps its browser
    Given an MCP-shaped process with a child, spawned by a session
    When the session stays alive
    Then nothing is signalled and the process keeps running

  @unit
  Scenario: The watch never keeps an exiting process alive
    Given a process that loads the watch and has nothing else to do
    Then it exits on its own, because the watch holds no part of the event loop
