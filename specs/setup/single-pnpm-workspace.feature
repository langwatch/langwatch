Feature: One workspace for every JavaScript project in the repo
  As someone working anywhere in the LangWatch repo
  I want a single install that covers every JavaScript project at once
  So that I stop guessing which directory to install from, and code shared
    between two projects can actually be shared

  See dev/docs/adr/076-single-pnpm-workspace.md.
  See dev/docs/adr/111-physical-application-workspaces.md for the planned
  physical application packages and amended npm staging workspace closure.

  # These scenarios describe how the repository installs, resolves and packages
  # itself. The @unit ones bind to apps/server/test/workspace-invariants.test.ts
  # (and, for the fresh-clone scenario, tools/thuishaven/app/deps_test.go; for
  # the entry-point scenario apps/server/test/pack-npm.test.ts, which runs the
  # real packaging script against a fixture repository; and for the prebuilt
  # app's install and links apps/server/test/app-archive.test.ts), which assert
  # the shape directly against the repo.
  #
  # Since ADR-180 the published package is the CLI alone and the app ships as a
  # prebuilt archive per platform (dev/docs/adr/180-npx-server-downloads-a-prebuilt-app.md,
  # specs/npx-installer/09-prebuilt-app.feature). The @unimplemented ones are
  # about what a full install resolves; their enforcement is the build: the
  # archive checks in dev/scripts/check-app-archive.sh and the npx-server-smoke
  # job, which boots the archive on three platforms.

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

  @unit
  Scenario: A fresh clone needs one install
    Given someone has just cloned the repo
    When they install dependencies once from the repo root
    Then every JavaScript project in the repo has its dependencies
    And no project requires a second install from its own directory
    # Previously the root install left the application unusable, and the
    # error it eventually produced named a missing binary rather than the
    # missing install.

  @unit
  Scenario: The repo holds one lockfile
    Given the repo
    When someone looks for lockfiles
    Then exactly one lockfile exists, at the repo root
    And no JavaScript project carries a lockfile of its own

  @unit
  Scenario: Projects that used to opt out of the workspace no longer do
    Given the skills compiler and the agentic end-to-end tests
    When their dependencies are installed
    Then neither has to ask to be excluded from the workspace
    # Both sat inside a workspace root without being members of it, so every
    # install of them needed a flag saying "pretend the workspace isn't there".

  # ===========================================================================
  # The name collision that blocked the merge
  # ===========================================================================

  @unit
  Scenario: The application and the SDK no longer share a package name
    Given the application and the TypeScript SDK
    When their package names are compared
    Then they differ
    # Both were called "langwatch". Two projects in one workspace cannot share
    # a name, and while they were apart the application declared a dependency
    # on its own name, which silently resolved to the published SDK instead of
    # to itself.

  @unit
  Scenario: The application links the SDK working copy
    Given the application depends on the TypeScript SDK
    When its dependencies are installed
    Then it resolves to the SDK in this repo, not a published release
    # So an SDK change reaches the application — and the production image built
    # from it — without a publish. Renaming the application is what removed the
    # ambiguity that made this impossible: both projects used to be called
    # "langwatch", so the application's dependency on the SDK was a dependency
    # on its own name.

  @unit
  Scenario: The SDK carries its own copy of a pinned dependency
    Given the SDK validates its own responses with a major of zod the application does not use
    When the SDK is built
    Then that dependency is bundled into the SDK rather than imported from the consumer
    # This is what makes the link above survivable. The application pins zod 3
    # and collapses every copy onto it, because zod 3 instanceof-checks its own
    # classes and a second copy silently mis-parses. Left external, the SDK's
    # zod-4 calls land on that v3 object and throw at first import — the whole
    # application, not just the SDK path.

  # ===========================================================================
  # Shared dependency policy
  # ===========================================================================

  @unimplemented
  Scenario: Security overrides are declared once
    Given a dependency that has to be pinned to a patched version
    When the pin is declared at the repo root
    Then every project in the repo resolves to the patched version
    And no project can silently keep an unpatched copy

  @unimplemented
  Scenario: Merging the override lists loses no existing pin
    Given the override lists the separate roots used to carry
    When they are combined into the single root list
    Then every package that was pinned before is still pinned
    And where two roots pinned the same package differently, the stricter
      value is the one that survives
    # The looser value was, by definition, leaving a project exposed. One
    # package was required at a higher floor by one project than by the other
    # two, and the lower floor had been silently accepted everywhere else.

  @unit
  Scenario: No project keeps a dependency rule that no longer applies
    Given a project that used to be its own install root
    When it becomes a member of the single workspace
    Then it carries no dependency-override rules of its own
    # A member's overrides are ignored outright rather than merged, so one
    # left behind reads as an active security pin while doing nothing at all.
    # Two projects each carried a second list in a place that was only ever
    # read while they were roots.

  @unit
  Scenario: A pin that suits one project is not forced onto the others
    Given a project that pinned an exact version of a package it depends on
      directly
    When the override lists are merged
    Then that pin does not become a repo-wide rule
    And each project still resolves the version it declares
    # Three projects legitimately sit on three different majors of the same
    # validation library. A blanket pin from one of them would drag the
    # application onto a major it is not built for.

  @unit
  Scenario: A shared internal package is reachable from every project
    Given an internal package that two projects both need
    When either project declares a dependency on it
    Then it resolves to the working copy in the repo
    # Before, an internal package was reachable only from the roots that
    # happened to list it, so a third project needing it had no way to say so.

  # ===========================================================================
  # The published installer keeps working
  # ===========================================================================

  @unimplemented
  Scenario: The published package still installs on an end user's machine
    Given someone runs the published LangWatch server package
    When it prepares the application on first start
    Then it installs the prebuilt app built for its version and platform
    And nothing is installed or built on that machine
    And the app holds no SDK sources, skills compiler or test suites

  @unit
  Scenario: The install still refuses to drift from the lockfile
    Given the prebuilt app is being built
    When its production dependencies are installed
    Then the install fails if the lockfile does not match the manifests
    # The frozen-lockfile guarantee is what makes the app reproducible; the
    # production image and the app archive share the one install that keeps it.

  @unimplemented
  Scenario: The published layout is not a mirror of the repository layout
    Given the published package is assembled
    When its layout is chosen
    Then it is decided by the packaging step, not by where files sit in the repo
    # The two were the same thing, so moving a directory in the repo silently
    # changed what shipped. Rearranging the workspace broke the published
    # install exactly that way.

  @unit
  Scenario: Every entry point the published package advertises resolves inside it
    Given the published package holds only the CLI
    When its manifest is written for that layout
    Then every path it advertises as an entry point names a file the package ships
    # Once the package advertised the repository's paths: nothing failed at
    # publish time, and only someone importing the package by name found
    # nothing there.

  @unit
  Scenario: Every project the lockfile mentions is resolvable
    Given the prebuilt app is built
    When its links are checked
    Then no internal package link is left pointing at a missing directory
    # A workspace member missing from the tree installs without complaint and
    # fails much later, inside a database migration.

  # ===========================================================================
  # Building
  # ===========================================================================

  @unit
  Scenario: A fresh clone starts the applications without a manual build step
    Given someone has cloned the repo and installed once from the root
    And two workspace packages are consumed as a bundle rather than as source
    When they start any of the three Node applications
    Then those two bundles are produced first, without being asked for
    And the repository's file-generation step no longer builds them
    # They used to be built by the same `&&` chain that generates the Prisma
    # client and the evaluator types, so a contributor who did not know that
    # chain existed got a dependency-scan failure from the browser build tool
    # and an unresolvable import in the API — neither of which names a build.

  @unit
  Scenario: A stale SDK build is rebuilt before the browser application starts
    Given the TypeScript SDK's source has changed since its bundle was built
    When the browser application is started
    Then the SDK is rebuilt before the application starts
    And an application whose bundles are already current starts without
      rebuilding anything
    # The check is a modification-time comparison, not a build system: the
    # point is that a lane never serves a bundle older than the source it was
    # built from, and never pays for a build it does not need.

  @unit
  Scenario: A fresh worktree prepares its databases without a manual bundle build
    Given a worktree that has installed but never built the TypeScript SDK
    When its databases are prepared, by haven or by `pnpm start:prepare:db`
    Then the SDK is built first, without being asked for
    And a worktree whose SDK bundle is newer than its sources builds nothing
    And `pnpm task`, `pnpm prisma:migrate` and `pnpm clickhouse:migrate` do the same
    # The migration tasks load the observability package, which resolves the
    # published SDK from its built dist; a fresh worktree failed there with
    # ERR_MODULE_NOT_FOUND. The root script and dev-stack.sh ensure it first;
    # the production image runs the api script and never builds.

  @unimplemented
  Scenario: Building a project builds what it depends on first
    Given a project that depends on another project in the repo
    When it is built
    Then its dependencies are built first, in order
    And nothing has to be built by hand beforehand

  @unimplemented
  Scenario: The MCP server is built once
    Given continuous integration builds the application
    When the MCP server is needed
    Then it is installed and built once
    # It was installed twice, from two roots, on every application build.
