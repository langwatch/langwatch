Feature: haven install offers to put the Go bin dir on PATH
  `make haven install` runs `go install ./cmd/haven`, which drops the binary
  in the Go bin dir (GOBIN, or GOPATH/bin). If that dir is not on PATH, the
  freshly installed `haven` command doesn't work and the "run 'haven ...'
  directly" promise is broken. The install target should notice and offer to
  fix it, instead of leaving the user to diagnose a command-not-found.

  # Behavior lives in scripts/haven-install-path.sh, invoked by the
  # `make haven install` branch in dev/haven.mk after `go install`.
  # Bound by scripts/__tests__/haven-install-path.unit.bats.

  @unit
  Scenario: Go bin dir already on PATH
    Given the Go bin dir is already on PATH
    When I run "make haven install"
    Then it confirms where haven was installed
    And no PATH change is offered

  @unit
  Scenario: Go bin dir missing from PATH, user accepts
    Given the Go bin dir is not on PATH
    And the install runs in an interactive terminal
    When I accept the offer to add it to PATH
    Then a PATH line for the Go bin dir is appended to my shell rc file
    And I am told to restart my shell or source the rc file

  @unit
  Scenario: Go bin dir missing from PATH, user declines
    Given the Go bin dir is not on PATH
    And the install runs in an interactive terminal
    When I decline the offer
    Then my shell rc file is not modified
    And the line to add manually is printed

  @unit
  Scenario: Non-interactive install never edits the rc file
    Given the Go bin dir is not on PATH
    And the install runs without a terminal attached
    When I run "make haven install"
    Then my shell rc file is not modified
    And the line to add manually is printed

  @unit
  Scenario: Accepting twice does not duplicate the PATH line
    Given my shell rc file already has the PATH line from a previous accept
    When I run "make haven install" again
    Then the rc file still has exactly one PATH line
    And I am told the rc file is already configured

  @unit
  Scenario: Unrecognized shell falls back to instructions
    Given my login shell is not zsh, bash, or fish
    And the Go bin dir is not on PATH
    When I run "make haven install"
    Then no rc file is touched
    And the export line to add manually is printed
