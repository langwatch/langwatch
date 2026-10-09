# See ../../../dev/docs/ARCHITECTURE.md §2, §3.4 and §10.1 (Alex, 2026-10-06, rounds 4 and 7b)

Feature: A module's client package has its own role
  As a module owner
  I want the linters to know a `<name>-client` package as a client, not a portable library
  So that it holds the derived tRPC hooks and its owner's lent tokens, and only browsers read it

  @unit @architecture
  Scenario: A client may depend on its own contract, the wire, browser-host and React
    Given a module client that depends on its own contract, @langwatch/api, @langwatch/browser-host and react
    And another module's browser package that depends on it
    When architecture lint checks the packages
    Then no package-role, cross-feature or feature-layout violation is reported

  @unit @architecture
  Scenario: A client may not depend on a process, browser or store package
    Given a module client that depends on its own process package, another module's browser package, another module's contract and a store client
    When architecture lint checks the client
    Then each of those dependencies is reported as a package-role violation

  @unit @architecture
  Scenario: Only browser packages and the browser application may depend on a client
    Given a process package, a contract, another client and the api application that each depend on a module client
    When architecture lint checks the packages
    Then each of those edges is reported as a package-role violation
    And the browser application importing the client is not reported

  @unit @architecture
  Scenario: A server application importing a client in source is refused
    Given the api application imports a module client in source
    When architecture lint checks the application boundaries
    Then the import is reported as an application-boundary violation

  @unit @architecture
  Scenario: A client file may import React, browser-host and the wire, and nothing else of a runtime
    Given a source file in a module client
    When it imports react, @langwatch/browser-host, @langwatch/api/web or its own contract
    Then package-boundaries reports nothing
    When it imports node:fs, react-dom, the design system, @langwatch/browser, a process package or a store client
    Then package-boundaries reports clientRuntime

  @unit @architecture
  Scenario: A client is read only by browser code
    Given another module's browser package and apps/ui import a module client
    Then package-boundaries reports nothing
    When a process package, a contract or apps/api imports the client
    Then package-boundaries reports clientConsumer
