Feature: Traces can be exported back out over HTTP

  A person can take their project's captured traces with them — CSV or JSONL,
  streamed as a download, with progress relayed back to the page they asked
  from. The export itself, its two formats and its two modes are described in
  `specs/traces/trace-export.feature`; what this describes is the door.

  # The family was built and had no caller. The route existed in the trace
  # package, the browser had the button, and the API process mounted nothing at
  # `/api/export/traces` — so ingestion worked and getting the data back out
  # did not.
  #
  # Three things decide whether it is mounted, and each one is a correctness
  # condition rather than a convenience. The SESSION is what makes a bulk
  # download attributable to a person. The READ STACK is what the export reads
  # through, so a door mounted without it would serve captured content past the
  # redactions every other trace surface applies — a data-privacy policy, a
  # restricted-attribute rule and a plan's visibility cutoff all live there.
  # The BROADCAST is where the progress goes. Missing any of them, the family
  # is left off and named at boot.

  @integration
  Scenario: The download is reachable on a deployment that composed it
    Given the deployment composed a browser session, a trace read stack and a broadcast
    When the process mounts its REST families
    Then `/api/export/traces/download` answers

  @integration
  Scenario: A deployment with no trace read stack leaves the download off
    Given the deployment composed no trace read stack
    When the process mounts its REST families
    Then `/api/export/traces/download` is not mounted at all rather than mounted refusing

  @integration
  Scenario: An anonymous caller is refused before anything is read
    Given nobody is signed in behind the request
    When a download is requested
    Then it is refused as unauthenticated
    And no trace is read

  @integration
  Scenario: A signed-in caller without permission on the project is refused
    Given a signed-in person who does not hold `traces:view` on the project
    When a download is requested for that project
    Then it is refused
    And no trace is read

  @integration
  Scenario: The export reads through the same redactions every other trace surface applies
    Given a signed-in person who holds `traces:view` on the project
    When a download is requested for that project
    Then the export is resolved with that person's own read-time protections
