@adr-132
Feature: The browser-node-leak policy
  A browser-reachable package (a `*-contract`, `*-browser` or `*-browser-kit`
  package, or the Design System) that value-imports a Node builtin — even
  deep in its own dependency graph — throws when the browser bundle loads it.
  The importing file can be legitimate server code; the defect is that a
  browser-reachable package can reach it at all, which is a graph property no
  per-file rule can see.

  Rule: `browser-node-leak` fails a browser-reachable package whose
    value-import graph reaches a Node builtin

  Background:
    Given a workspace with a contract package and a plain framework package

  @unit
  Scenario: A contract package directly importing a Node builtin is reported
    Given the contract package's entry imports "node:crypto" directly
    When the browser-node-leak policy runs over the workspace
    Then it reports the file that imports "node:crypto"

  @unit
  Scenario: A bare specifier without the node: prefix is still reported
    Given the contract package's entry imports the bare specifier "crypto"
    When the browser-node-leak policy runs over the workspace
    Then it reports the file that imports "crypto"

  @unit
  Scenario: A Node builtin reached only through another package is reported
    Given the contract package imports a framework package whose entry imports "node:fs"
    When the browser-node-leak policy runs over the workspace
    Then it reports the framework package's file that imports "node:fs"
    And not the contract package's own file

  @unit
  Scenario: A require() of a Node builtin inside a function is reported
    Given the contract package's entry calls require("node:os") inside a function body
    When the browser-node-leak policy runs over the workspace
    Then it reports the file that calls require("node:os")

  @unit
  Scenario: An import type of a Node-importing module is not reported
    Given the contract package's entry writes "import type" from a file that imports "node:child_process"
    When the browser-node-leak policy runs over the workspace
    Then it reports nothing

  @unit
  Scenario: An export type re-export of a Node-importing module is not reported
    Given the contract package's entry writes "export type { X }" from a file that imports "node:child_process"
    When the browser-node-leak policy runs over the workspace
    Then it reports nothing

  @unit
  Scenario: A server package outside the browser-reachable set is not reported
    Given a process package, never a contract, browser or browser-kit package, imports "node:fs"
    When the browser-node-leak policy runs over the workspace
    Then it reports nothing
