# See ../../dev/docs/adr/145-python-uv-workspace.md — the Python counterpart
# of ../setup/single-pnpm-workspace.feature. services/langevals is deliberately
# not a member; it keeps its own workspace and lock.

Feature: Python uv workspace
  As a platform maintainer
  I want every workspace Python project resolved from one root lockfile
  So that a security pin applied once holds everywhere and members can depend on each other

  @unit
  Scenario: The workspace root declares the Python members
    When the root pyproject is read
    Then it is virtual and lists sdks/python and packages/ksuid-python as members

  @unit
  Scenario: Workspace members carry no lockfile of their own
    # A member uv.lock is dead state: uv resolves members from the root lock,
    # so a stray member lock only misleads tooling and reviewers about what
    # is actually installed.
    When the member directories are inspected
    Then none of them contains a uv.lock

  @unit
  Scenario: Resolution settings live only at the workspace root
    # uv silently ignores a member's [tool.uv] resolution settings, so a
    # security pin declared on a member is decorative — it must sit in the
    # root pyproject to hold.
    When the member pyprojects are read
    Then none of them declares exclude-newer or constraint-dependencies
    And the root pyproject carries the security constraint pins

  @unit
  Scenario: A member's release bumps its version in the root lock
    # The root uv.lock records each member's version. A release PR that bumps
    # pyproject.toml but not the lock is relocked by CI and fails (#9175).
    When the release configuration is read
    Then every member's release also updates its own entry in the root uv.lock
