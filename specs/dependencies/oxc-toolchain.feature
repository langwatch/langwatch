# See ../../packages/architecture-lint/adrs/003-unified-oxc-toolchain.md
# Complements ../../packages/architecture-lint/specs/feature-package-boundaries.feature,
# which owns feature-graph and source-architecture diagnostics.
# The application-workspace migration is specified by
# application-workspace-boundaries.feature.
# At cutover this amends the active tool names in ../setup/check-slots.feature
# and ../claude/agent-admission-gate.feature; their resource-governance
# invariants remain authoritative.

Feature: Repository-wide Oxc lint and format toolchain
  As a repository contributor
  I want one lint and format policy for every JavaScript and TypeScript workspace
  So that moving code between applications and packages does not change its checks

  Rule: One root toolchain governs every applicable workspace

    @architecture @lint @typecheck @unimplemented
    Scenario: Every first-party JavaScript and TypeScript root uses Oxlint
      Given applications, packages, SDKs, MCP, services, skills, tools and tests contain first-party JavaScript or TypeScript
      When their lint commands, dependencies and configuration are inspected
      Then Oxlint is their only general-purpose JavaScript and TypeScript linter
      And the root workspace owns its pinned version and configuration
      And the root owns the pinned oxlint-tsgolint companion rather than leaving it to individual packages
      And a package-local lint command may narrow files but cannot replace the root policy

    @architecture @format @unimplemented
    Scenario: Every supported first-party file type uses Oxfmt
      Given first-party source, configuration and documentation use a file type supported by Oxfmt
      When their formatting commands and configuration are inspected
      Then Oxfmt is their only repository formatter
      And the root workspace owns its pinned version and configuration
      And a package-local format command may narrow files but cannot replace the root policy

    @architecture @lint @format @unimplemented
    Scenario: Other ecosystems keep purpose-specific checks
      Given the repository also contains Go, Python, generated artifacts and specialist architecture or security rules
      When the Oxc migration is complete
      Then each non-JavaScript ecosystem retains its native linter and formatter
      And architecture lint, ast-grep, Semgrep, gitleaks and generated-file checks retain their declared concerns
      And none is duplicated merely to claim that Oxc owns every kind of check

  Rule: Rule coverage survives the migration

    @architecture @lint @migration @unimplemented
    Scenario: Every old rule receives an explicit disposition
      Given an enabled Biome or ESLint rule, plugin, override or ignore
      When the migration inventory is completed
      Then it maps to a native Oxlint rule, an Oxlint JavaScript plugin, an existing specialist gate or a documented retirement
      And a retirement explains why the old rule is no longer desired
      And no rule disappears only because the replacement lacks an equivalent name

    @integration @lint @typecheck @unimplemented
    Scenario: Type-aware promise checks remain blocking
      Given a typecheckable TypeScript project contains a floating promise or passes an async callback where a synchronous callback is required
      When Oxlint runs with the project's discovered TypeScript configuration
      Then the matching type-aware diagnostic is reported
      And removal of the Biome or typescript-eslint check is blocked until this scenario passes

    @unit @lint @architecture
    Scenario: LangWatch house rules keep executable fixtures
      Given a package-boundary, service-class or raw-error-toast rule has valid, invalid and suppressed fixtures
      When the corresponding Oxlint native or JavaScript plugin rule runs
      Then invalid source is rejected
      And valid source is accepted
      And an intentional suppression requires the documented reason-bearing form

    @integration @lint @migration @unimplemented
    Scenario: Legacy lint debt cannot grow during cutover
      Given a retained lint rule has findings in the existing tree
      When CI compares the branch against its checked-in baseline by stable file and rule identity
      Then an increased count fails
      And a decreased count passes and can lower the baseline
      And CI never raises or regenerates the baseline automatically

    @integration @lint @unimplemented
    Scenario: Clean rules remain full-tree gates
      Given a retained lint rule has no accepted legacy findings
      When any governed source violates it
      Then the repository lint command fails regardless of whether the violating line is in the pull-request diff

    @architecture @lint @unimplemented
    Scenario: Lint exclusions are narrow and owned
      Given generated, vendored or machine-sized source cannot receive ordinary lint diagnostics
      When the root Oxlint configuration excludes it
      Then the exclusion names the smallest stable generated or vendored file class
      And a comment names the generator, upstream owner or replacement integrity check
      And no hand-authored source directory is excluded wholesale to avoid migration work

  Rule: Formatting is deterministic and separate from linting

    @integration @format @unimplemented
    Scenario: Formatting checks never modify the worktree
      Given a supported first-party file is not in canonical Oxfmt form
      When pnpm format:check runs locally or in CI
      Then the command exits non-zero
      And the file remains byte-for-byte unchanged

    @integration @format @unimplemented
    Scenario: The write command produces the checked representation
      Given a supported first-party file is not in canonical Oxfmt form
      When pnpm format runs
      Then Oxfmt writes the canonical representation
      And a following pnpm format:check succeeds without another change

    @architecture @format @unimplemented
    Scenario: Formatting does not perform semantic sorting during migration
      Given JavaScript imports or package-manifest keys have an intentional order
      When Oxfmt formats the file
      Then optional import sorting and package-manifest key sorting are disabled
      And formatting changes layout without changing evaluation or manifest meaning

    @architecture @format @unimplemented
    Scenario: Formatting exclusions are narrow and explained
      Given a generated artifact, vendored source, lockfile, whitespace-sensitive fixture or unsupported language must not be formatted
      When the root Oxfmt configuration excludes it
      Then the exclusion names the smallest stable path or file class
      And a comment explains which owner or invariant formats the excluded content
      And no first-party source directory is excluded wholesale to avoid migration work

  Rule: Local, filtered, editor and CI behavior agree

    @integration @lint @unimplemented
    Scenario: The read-only lint command does not prepare or rewrite source
      Given generated artifacts and source files already exist
      When pnpm lint runs
      Then no generator, formatter or fixer is invoked implicitly
      And the worktree remains byte-for-byte unchanged
      And generated-artifact freshness remains a separate explicit gate

    @integration @lint @format @ci @unimplemented
    Scenario: CI uses the workspace binaries and root configurations
      Given Oxlint and Oxfmt are installed from the frozen root lockfile
      When required lint and format checks run in CI
      Then they use the same versions, configurations and governed paths as root contributor commands
      And no action-bundled linter or formatter version participates in enforcement
      And annotation may be diff-filtered but enforcement is not delegated to annotation

    @integration @lint @format @ci @unimplemented
    Scenario Outline: A broken or empty check fails visibly
      Given the <failure> affects a required Oxc check
      When that check runs
      Then it exits non-zero
      And CI does not report that zero governed files were successfully checked

      Examples:
        | failure                         |
        | root configuration is invalid  |
        | a parser or plugin crashes      |
        | the governed path set is empty |

    @integration @lint @format @unimplemented
    Scenario: Filtered package commands preserve root policy
      Given a contributor filters lint or formatting to one workspace package
      When the package command runs
      Then only that package's applicable files are selected
      And the root Oxlint or Oxfmt policy is still used
      And the package does not acquire a private config or binary version

    @architecture @lint @format @unimplemented
    Scenario: Lint fixes and formatting have distinct commands
      Given source has both a safe lint fix and non-canonical layout
      When pnpm lint:fix runs
      Then only the enabled safe lint fix is applied
      And pnpm format remains the command that changes layout

  Rule: Cutover removes the old active toolchain completely

    @architecture @lint @format @migration @unimplemented
    Scenario: Active Biome and ESLint tooling is removed
      Given Oxlint parity and the Oxfmt rewrite have passed
      When the repository switches its required checks to Oxc
      Then active Biome configs, direct dependencies, scripts, CI gates and editor instructions are removed
      And package-local ESLint configs and lint-only dependencies are removed
      And no active command shells out to Biome or ESLint as a fallback
      And historical ADR and changelog references remain historical

    @architecture @format @migration @unimplemented
    Scenario: Oxfmt replaces repository use of Prettier without breaking runtime code
      Given a direct Prettier dependency or command is classified by its purpose
      When the formatter migration is complete
      Then formatting-only dependencies, configurations and scripts are removed
      And a runtime dependency remains only when product code imports it for product behavior
      And transitive dependency names are not mistaken for active formatter ownership

    @integration @migration @unimplemented
    Scenario: The formatting rewrite is isolated from behavior changes
      Given the root Oxfmt configuration and exclusions are fixed
      When the existing repository is rewritten once
      Then the rewrite contains only canonical formatting changes
      And generated, vendored and whitespace-sensitive excluded content is unchanged
      And subsequent feature commits are reviewed without migration-wide formatting noise

    @architecture @migration @unimplemented
    Scenario: Active tooling guidance names Oxc after cutover
      Given scripts, CI, editor settings, contributor guidance, check shims and resource-governance classification mention the active tools
      When cutover is complete
      Then they name Oxlint and Oxfmt rather than Biome, ESLint or Prettier-as-formatter
      And direct binary invocation and root package commands observe the same resource-governance policy
