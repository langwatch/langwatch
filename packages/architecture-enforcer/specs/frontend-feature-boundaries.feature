# The kit law, dev/docs/ARCHITECTURE.md §3.4.

Feature: A module's browser package is closed
  As a maintainer
  I want every edge onto a module's browser package refused, at import and at manifest level
  So that sharing happens through a browser-kit and never through a side door

  @unit @architecture
  Scenario: A cross-module import of a browser package is reported
    Given a module's browser package imports another module's browser package
    When the browser package closure is checked
    Then the import is reported against the importing file

  @unit @architecture
  Scenario: A bare side-effect import of a browser package is reported
    Given a file imports another module's browser package for its side effect alone
    When the browser package closure is checked
    Then the import is reported

  @unit @architecture
  Scenario: A re-export naming a browser package is reported
    Given a file re-exports from another module's browser package
    When the browser package closure is checked
    Then the re-export is reported

  @unit @architecture
  Scenario: A type-position dynamic import naming a browser package is reported
    Given a file names another module's browser package in a typeof import type
    When the browser package closure is checked
    Then the reference is reported, because a test can load it at run time

  @unit @architecture
  Scenario: apps/ui may import a browser package
    Given apps/ui imports a module's browser package
    When the browser package closure is checked
    Then nothing is reported, because apps/ui installs browser halves

  @unit @architecture
  Scenario: A browser package's own files may import themselves
    Given a browser package imports one of its own subpaths
    When the browser package closure is checked
    Then nothing is reported

  @unit @architecture
  Scenario: A manifest dependency edge onto a browser package is reported
    Given a module package declares another module's browser package as a dependency
    When the browser package closure is checked
    Then the manifest edge is reported whether or not any source file uses it

  @unit @architecture
  Scenario: One manifest edge onto a browser package is reported once
    Given a browser package and a kit each declare another module's browser package
    When the manifest, kit and closure policies all run
    Then each edge is reported once, by the manifest closure
    And neither the cross-feature manifest check nor the kit dependency check repeats it

  @unit @architecture
  Scenario: A browser package with a surfaces/* export entry is reported
    Given a browser package's exports map declares an entry other than ./declaration
    When its exports are checked
    Then every such entry is reported as a side door

  @unit @architecture
  Scenario: A kit with a named subpath export entry is reported
    Given a kit's exports map declares an entry other than "."
    When its exports are checked
    Then every such entry is reported

  @unit @architecture
  Scenario: A kit depending on a browser or a sibling kit is reported
    Given a kit declares a dependency on another kit or on a package that is not in the fixture's browser set
    When its dependencies are checked
    Then each dependency outside contracts, the Design System and browser-host is reported

  @unit @architecture
  Scenario: A kit's contract, Design System and browser-host dependencies pass
    Given a kit depends only on contracts, the Design System and browser-host
    When its dependencies are checked
    Then nothing is reported
