@unit
Feature: haven obs cpu, heap and compare profile a stack's Node lanes
  An agent profiles a running stack's Node process with one command and reads
  the result in one screen: where the CPU went, what the heap holds, and,
  after a change, what moved. The profile is saved where Chrome DevTools opens
  it. See ADR-064, amendment 2026-10-23.

  Scenario: A lane resolves to the process listening on its port
    Given a running stack whose api lane listens on its API port
    When the agent runs "haven obs cpu api"
    Then haven profiles the process listening on that port
    And when the workers lane is served by the same process the output says so
    And a lane the stack does not have exits 64 naming the lanes it has
    And a stopped stack or lane exits 65 naming "haven up --agent -d"

  Scenario: The inspector is opened for the profile and closed after
    Given a Node process with no inspector open
    When haven profiles it
    Then haven opens the inspector with SIGUSR1, records, and closes the inspector again
    And an inspector the process already had open is used and left open

  Scenario: A CPU profile is saved with a summary
    When the agent runs "haven obs cpu api --duration 30s"
    Then the .cpuprofile is saved under .claude/tmp/haven-profiles/<stack>/ and its path printed on its own line
    And the summary gives the window in seconds, samples, busy, GC and idle as percentages
    And self time by function (with file and line), by file and by package, and inclusive time, each in ms and percent
    And dependency paths collapse to their package name, repository code to its workspace directory
    And --json gives the same as data

  Scenario: Load is driven during the window on request
    When the agent runs "haven obs cpu api --load telemetry:50"
    Then telemetrysim sends llm-trace batches at 50 per second for the profile's window
    And the summary reports how many were sent, acked and failed
    And a --load that is not telemetry:<rate> exits 64

  Scenario: A heap profile is sampled or snapshotted
    When the agent runs "haven obs heap api"
    Then a sampling heap profile reports the sampled MB by function, file and package
    When the agent runs "haven obs heap api --snapshot"
    Then the snapshot reports self size by type and constructor, retained size by constructor and the biggest holders
    And the biggest strings, flagging those V8 stores two-byte, with the two-byte total
    And npm packages loaded from more than one pnpm directory

  Scenario: Two CPU profiles compare
    When the agent runs "haven obs compare api" after profiling the api lane twice
    Then it diffs the lane's last two saved profiles: busy and GC as percentage points
    And per function and per package the self-time share before, after and the change, biggest change first
    And a function matches itself across profiles even when its line moved
    And "haven obs compare <before> <after>" diffs two named .cpuprofile files
