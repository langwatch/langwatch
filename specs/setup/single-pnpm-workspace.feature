Feature: One workspace for every JavaScript project in the repo
  As someone working anywhere in the LangWatch repo
  I want a single install that covers every JavaScript project at once
  So that I stop guessing which directory to install from, and code shared
    between two projects can actually be shared

  See dev/docs/adr/076-single-pnpm-workspace.md.

  # Context. The repo grew six independent pnpm install roots — the repo root,
  # the application, the TypeScript SDK, the MCP server, the skills compiler,
  # and the agentic end-to-end tests. Each carried its own lockfile, so a
  # fresh clone needed several installs in the right order and a newcomer who
  # ran only the obvious one got a broken toolchain. Two of those roots
  # overlapped: the MCP server was both its own root and a member of the
  # application's workspace, so continuous integration installed it twice.
  #
  # The roots also each carried their own dependency override list. Those
  # lists drifted, which matters because overrides are how the repo pins
  # security fixes: a package patched in one root could stay vulnerable in
  # another, and nothing announced the gap.

  # ===========================================================================
  # A single install covers everything
  # ===========================================================================

  Scenario: A fresh clone needs one install
    Given someone has just cloned the repo
    When they install dependencies once from the repo root
    Then every JavaScript project in the repo has its dependencies
    And no project requires a second install from its own directory
    # Previously the root install left the application unusable, and the
    # error it eventually produced named a missing binary rather than the
    # missing install.

  Scenario: The repo holds one lockfile
    Given the repo
    When someone looks for lockfiles
    Then exactly one lockfile exists, at the repo root
    And no JavaScript project carries a lockfile of its own

  Scenario: Projects that used to opt out of the workspace no longer do
    Given the skills compiler and the agentic end-to-end tests
    When their dependencies are installed
    Then neither has to ask to be excluded from the workspace
    # Both sat inside a workspace root without being members of it, so every
    # install of them needed a flag saying "pretend the workspace isn't there".

  # ===========================================================================
  # The name collision that blocked the merge
  # ===========================================================================

  Scenario: The application and the SDK no longer share a package name
    Given the application and the TypeScript SDK
    When their package names are compared
    Then they differ
    # Both were called "langwatch". Two projects in one workspace cannot share
    # a name, and while they were apart the application declared a dependency
    # on its own name, which silently resolved to the published SDK instead of
    # to itself.

  Scenario: The application still gets the published SDK
    Given the application depends on the TypeScript SDK
    When its dependencies are installed
    Then it resolves to the published SDK release, not the working copy
    # Renaming the application removes the ambiguity but deliberately does not
    # change what ships. Linking the working copy is a separate decision.

  # ===========================================================================
  # Shared dependency policy
  # ===========================================================================

  Scenario: Security overrides are declared once
    Given a dependency that has to be pinned to a patched version
    When the pin is declared at the repo root
    Then every project in the repo resolves to the patched version
    And no project can silently keep an unpatched copy

  Scenario: Merging the override lists loses no existing pin
    Given the override lists the separate roots used to carry
    When they are combined into the single root list
    Then every package that was pinned before is still pinned
    And where two roots pinned the same package differently, the stricter
      value is the one that survives
    # The looser value was, by definition, leaving a project exposed. One
    # package was required at a higher floor by one project than by the other
    # two, and the lower floor had been silently accepted everywhere else.

  Scenario: No project keeps a dependency rule that no longer applies
    Given a project that used to be its own install root
    When it becomes a member of the single workspace
    Then it carries no dependency-override rules of its own
    # A member's overrides are ignored outright rather than merged, so one
    # left behind reads as an active security pin while doing nothing at all.
    # Two projects each carried a second list in a place that was only ever
    # read while they were roots.

  Scenario: A pin that suits one project is not forced onto the others
    Given a project that pinned an exact version of a package it depends on
      directly
    When the override lists are merged
    Then that pin does not become a repo-wide rule
    And each project still resolves the version it declares
    # Three projects legitimately sit on three different majors of the same
    # validation library. A blanket pin from one of them would drag the
    # application onto a major it is not built for.

  Scenario: A shared internal package is reachable from every project
    Given an internal package that two projects both need
    When either project declares a dependency on it
    Then it resolves to the working copy in the repo
    # Before, an internal package was reachable only from the roots that
    # happened to list it, so a third project needing it had no way to say so.

  # ===========================================================================
  # The published installer keeps working
  # ===========================================================================

  Scenario: The published package still installs on an end user's machine
    Given someone runs the published LangWatch server package
    When it prepares the application on first start
    Then it installs from the workspace shipped inside the package
    And it installs only the application and what the application needs
    And it does not install the SDK, the skills compiler, or the test suites
    # The published tarball is the reason the application used to need its own
    # lockfile. It now carries the repo's workspace definition and lockfile,
    # and narrows the install to the application at install time instead.

  Scenario: The install still refuses to drift from the lockfile
    Given the published package
    When it installs the application's dependencies
    Then the install fails if the lockfile does not match the manifests
    # The frozen-lockfile guarantee is what makes an end user's install
    # reproducible; narrowing the install must not weaken it.

  Scenario: Every project the lockfile mentions is resolvable
    Given the published package
    When its dependencies are installed
    Then no internal package link is left pointing at a missing directory
    # A workspace member whose directory was left out of the tarball installs
    # without complaint and fails much later, inside a database migration.

  # ===========================================================================
  # Building
  # ===========================================================================

  Scenario: Building a project builds what it depends on first
    Given a project that depends on another project in the repo
    When it is built
    Then its dependencies are built first, in order
    And nothing has to be built by hand beforehand

  Scenario: The MCP server is built once
    Given continuous integration builds the application
    When the MCP server is needed
    Then it is installed and built once
    # It was installed twice, from two roots, on every application build.
