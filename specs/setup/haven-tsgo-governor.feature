Feature: The TypeScript compiler can never take the machine down
  A whole-tree typecheck peaks around ten gigabytes, the check queue bounds how
  many run at once but not how big each gets, and language-server instances
  accumulate one per worktree, exempt from every admission control by design.
  Gating spawn paths is whack-a-mole — every new package, editor or daemon
  that spawns the compiler reopens the hole. So the guarantee moves to where
  every process is visible: the haven daemon watches the compiler itself, caps
  it softly at spawn where haven owns the spawn, and reclaims it forcibly when
  the machine is at stake. See dev/docs/adr/095-haven-tsgo-governor.md.

  # The compiler is one binary under two names: @typescript/native-preview
  # published it as `tsgo`, typescript@7 renamed it to `tsc`, and a local build
  # of the TypeScript repo still produces `tsgo`. Both are governed as ONE
  # class against ONE budget — the knobs keep their HAVEN_TSGO_ names.
  #
  # Behavior lives in tools/thuishaven: `domain/tsgowatch.go` decides what to
  # reclaim, `app/daemon.go` samples and enforces on the monitor tick, and
  # `dev/scripts/check-queue.mjs` sets the soft memory cap on the runs it
  # spawns. Knobs: HAVEN_TSGO_RUN_MAX_RSS_MB, HAVEN_TSGO_LSP_MAX_RSS_MB,
  # HAVEN_TSGO_LSP_IDLE_TTL, HAVEN_TSGO_TOTAL_BUDGET_MB (0 disables each).

  @unit
  Scenario: A runaway whole-tree run is stopped at the hard ceiling
    Given a whole-tree compiler run whose memory exceeds the per-run ceiling
    When the daemon takes its next sample
    Then that run is stopped
    And the reason, size and age are logged

  @unit
  Scenario: A run under every ceiling is left alone
    Given a whole-tree compiler run within the per-run ceiling
    And the combined compiler footprint is within the machine budget
    When the daemon takes its next sample
    Then nothing is stopped

  @unit
  Scenario: Over the machine budget, idle language servers go first
    Given the combined compiler footprint exceeds the machine budget
    And an idle language server and two whole-tree runs are live
    When the daemon takes its next sample
    Then the idle language server is reclaimed before any run

  @unit
  Scenario: Over the machine budget, the youngest run goes before the oldest
    Given the combined compiler footprint exceeds the machine budget
    And no idle language server is left to reclaim
    When the daemon takes its next sample
    Then the youngest whole-tree run is stopped first
    And the oldest keeps running

  @unit
  Scenario: An idle language server is evicted after the idle period
    Given a language server whose CPU clock has not moved for the idle period
    When the daemon takes its next sample
    Then it is evicted
    And a language server actively serving requests is never idle-evicted

  @unit
  Scenario: An oversized language server is evicted regardless of activity
    Given a language server above the language-server ceiling
    When the daemon takes its next sample
    Then it is evicted

  @unit
  Scenario: The governor only ever touches the TypeScript compiler
    Given processes of every other kind on the machine
    When the daemon takes its next sample
    Then none of them is ever a candidate

  # TypeScript 7 renamed the native binary from `tsgo` to `tsc`, which silently
  # emptied a governor that selected on the old name: the machine's largest
  # transient memory consumer was neither capped nor observed. One name is not
  # two classes — two classes would weigh each half of the machine's compilers
  # against the whole budget and reclaim neither.
  @unit
  Scenario: The compiler is governed under both of its names
    Given a run of the compiler installed as "tsc" and one installed as "tsgo"
    And they exceed the machine budget only when counted together
    When the daemon takes its next sample
    Then both are watched as one class
    And the youngest of the two is reclaimed
    And a language server keeps its own ceiling and idle period under either name

  @unit
  Scenario: Coding agents, dev servers and test workers are observed, never touched
    Given enormous node, coding-agent and test-worker processes
    When the daemon takes its next sample
    Then their footprint is recorded
    But none of them is ever a removal candidate

  @unit
  Scenario: Every watched tool's footprint becomes queryable history
    Given watched processes of several classes are live
    When the daemon takes its next sample
    Then each class's footprint is shipped to the local observability stack
    And every governor enforcement is counted there with its reason

  @unit
  Scenario: The operator can disable the governor
    Given the per-run ceiling is disabled via the environment
    When the daemon takes its next sample
    Then no compiler process is considered at all

  @unit
  Scenario: Queued whole-tree runs get a soft memory cap at spawn
    Given the check queue spawns a whole-tree compiler run
    Then the Go runtime memory limit is set from the machine's memory
    But an operator's explicit limit is never overridden

  @unit
  Scenario: The soft cap stays inside what a run can meet
    Given the machine has far more memory than a whole-tree run needs
    Then the run is capped well below what half the machine would allow
    And a small machine is still capped high enough for a run to meet it
    # A ceiling is one the runtime expands toward, so a generous cap is spent
    # rather than saved; a cap below the live heap is missed anyway, at the
    # price of collecting continuously. See ADR-100.
