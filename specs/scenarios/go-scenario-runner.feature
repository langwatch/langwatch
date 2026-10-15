Feature: The Go scenario runner honours the child execution contract

  `services/scenariorunner` is a Go program the worker can spawn in place of
  the Node scenario child (`apps/scenario-child`). It is started the same way
  and with the same environment, reads the same job on stdin and writes the
  same last line on stdout, so the parent's `parseResult` and its agent-test
  answer parser accept it unchanged. It runs the job on the Go scenario SDK.

  Which runner a worker spawns, and how the binary reaches the worker image,
  is decided elsewhere; this feature covers only the contract the runner keeps.

  # ---------------------------------------------------------------------------
  # The job it reads
  # ---------------------------------------------------------------------------

  Rule: The runner reads the job the parent writes

    @unit
    Scenario: A simulation job is read with its mappings and parameters in order
      Given a simulation job for an HTTP target with two field mappings and three parameters
      When the runner parses it
      Then the mappings and the parameters keep the order the job lists them in
      And each role's model params are read

    @unit
    Scenario: An agent-test turn job is read
      Given an agent-test turn job for a connected agent
      When the runner parses it
      Then it is read as one turn with its message and call deadline

    @unit
    Scenario: A job the runner cannot read fails with the Node child's prefix
      Given a job that is not JSON, lacks a required field, names no model or an unknown target
      When the runner parses it
      Then the run fails with "Failed to parse job data: " and the reason

  # ---------------------------------------------------------------------------
  # The line it writes
  # ---------------------------------------------------------------------------

  Rule: The runner's last stdout line is the one the parent parses

    @unit
    Scenario: Every result line is byte-equal to the Node child's
      Given a passed run, a failed verdict, a connected run, a run that threw and an agent-test answer
      When the runner writes each result line
      Then each line is exactly what JSON.stringify writes for the Node child

    @unit
    Scenario: A failure is flattened with its causes into one line
      Given an adapter error caused by a transport error
      When the runner formats it
      Then each message in the chain is joined with ": " and a code is named in parentheses

    @unit
    Scenario: A simulation runs on the Go SDK and ends with the verdict line
      Given a simulation of an HTTP target with a simulator and a judge model
      When the runner runs it
      Then the target is called, the judge decides, and the last line is the verdict
      And the run's events and spans reach LangWatch with the parent's resource attributes
      And every engine call carries the internal secret

    @unit
    Scenario: An agent-test turn answers through the HTTP target
      Given an agent-test turn for an HTTP target with a body template, a secret header and an output path
      When the runner runs it
      Then the target receives the rendered body and the resolved secret
      And the last line is the answer with its duration

  Rule: The runner refuses rather than assume

    @unit
    Scenario: A run without its egress policy or telemetry destination refuses by name
      Given a runner started without LANGWATCH_SCENARIO_EGRESS_POLICY, or without LANGWATCH_ENDPOINT
      When it runs a job
      Then it exits 1 with a line naming the missing variable

    @unit
    Scenario: A voice target is refused by name
      Given a job for a voice target
      When the Go runner runs it
      Then it exits 1 saying voice targets are not supported by the Go runner yet

  # ---------------------------------------------------------------------------
  # The fence an HTTP target is dialled through
  # ---------------------------------------------------------------------------

  Rule: The outbound fence is the deployment's, judged once

    @unit
    Scenario: The fence refuses private, loopback, metadata and cloud-internal destinations
      Given a policy that blocks local addresses
      When a target names a private or loopback address, a name resolving to one, cloud metadata or a cloud-internal domain
      Then the destination is refused with the packages/egress wording
      And cloud metadata is refused even where local addresses are allowed or the host is allowlisted

    @unit
    Scenario: A host is read as the Node child's URL parser reads it
      Given a target URL that spells an address in decimal, octal or hex, with full-width digits, or with a zone identifier
      When the fence reads its host
      Then a numeric spelling is judged as the IPv4 address it names
      And a zone identifier or an impossible number is refused as an invalid URL
      And no spelling reaches loopback, a private address or cloud metadata the canonical form would be refused for

    @unit
    Scenario: An allowlisted host passes and is pinned to its resolved address
      Given a policy that blocks local addresses and allowlists one host
      When a target names that host
      Then it passes and the address it resolved to is the one dialled

    @unit
    Scenario: The judged address is the one connected to and the name is never resolved again
      Given a target whose name resolves once
      When the runner calls it
      Then the connection goes to the judged address with the original Host header

    @unit
    Scenario: A redirect is refused as the Node child refuses it
      Given a target that answers with a redirect
      When the runner calls it
      Then the call fails with "Redirects are not followed without an address policy to judge the next hop."

    @unit
    Scenario: A followed redirect is judged again at every hop
      Given a fence that follows redirects
      When a hop points at a private address, at cloud metadata or at an allowed host
      Then the first two are refused and the allowed hop is followed without the credential header

    @unit
    Scenario: An HTTP target behind the fence is refused before any connection is made
      Given an agent-test turn whose HTTP target is on a loopback address
      And a policy that blocks local addresses
      When the runner runs it
      Then the line reports the target could not be reached and why

  # ---------------------------------------------------------------------------
  # Telemetry
  # ---------------------------------------------------------------------------

  Rule: Spans carry the resource the parent stated

    @unit
    Scenario: The parent's resource attributes keep a scenario's labels together
      Given OTEL_RESOURCE_ATTRIBUTES with the platform origin and labels that contain commas
      When the runner reads it
      Then langwatch.origin.source is "platform" and scenario.labels holds every label
