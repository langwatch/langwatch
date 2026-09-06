Feature: The browser's trimmed better-auth contract
  better-auth's own declarations reach its server half and, through it, a SQL
  query builder: naming `createAuthClient` loads 576 declaration files into a
  browser program, 251 of them kysely. The browser tsconfigs point the CHECKER
  at a hand-written contract in types/browser/ instead. Nothing about the
  runtime changes — vite resolves the real package — so the contract has to be
  held to the library it stands in for.

  @unit
  Scenario: The trimmed better-auth contract names only methods the library has
    Given the real better-auth client, built with the passkey plugin
    When every method the browser contract promises is looked up on it
    Then each one is there
