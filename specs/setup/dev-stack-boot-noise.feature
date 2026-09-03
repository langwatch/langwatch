# A developer ran `pnpm dev` and read a wall of errors before the stack had
# served a single request. Every one of them was either a lie about a real
# failure, or a real failure being announced over and over. None of them was
# something anybody was expected to act on, which is the whole problem: a boot
# log where nothing is actionable is a boot log nobody reads, and the one line
# that mattered scrolled past with the rest.
#
# See specs/setup/dev-stack-log-format.feature for how a line is SHAPED once
# it has earned the right to be printed.

Feature: A dev stack boots quiet
  As a developer starting the local stack
  I want the boot to print only what I have to act on
  So that a real failure is the thing I notice, not the thing I miss

  # --- Absence is not an error ---

  # `getConfig()` threw when the MCP configuration had not been initialised
  # yet, and printed a synthesized stack trace to the console on its way out.
  # Its one caller wraps it in try/catch and initialises on the catch, so the
  # "failure" was the normal cold-start path, announced as a stack trace on
  # every boot.
  @unit
  Scenario: Asking whether the MCP configuration exists is not a failure
    Given a process that has not initialised the MCP configuration
    When it asks whether one is there
    Then it is told there is none
    And nothing is printed

  @unit
  Scenario: A caller that needs the MCP configuration is still refused loudly
    Given a process that has not initialised the MCP configuration
    When it demands the configuration rather than asking for it
    Then it is refused

  @unit
  Scenario: The initialised configuration is what the asking caller gets
    Given a process that has initialised the MCP configuration
    When it asks whether one is there
    Then it is handed the configuration it initialised

  # The API process's boot statement had the same shape of problem — it warned
  # about a Better Auth transport it then composed for itself. That one lives
  # with the process it belongs to: see specs/server/api-process-auth.feature,
  # "An absence is announced by whatever ran into it".

  # --- Silence is a configuration, not an accident ---

  # With no LangWatch credentials, the observability SDK set OpenTelemetry up,
  # exported to nowhere, and logged a nine-line ERROR every boot — in the api
  # lane and the workers lane both — telling the deployment off for it. A
  # process that has been given nowhere to send traces has not been
  # misconfigured; it has been configured not to send them.
  #
  # Turning OpenTelemetry off outright would silence it and cost the thing the
  # spans are still worth locally: every log line a request produces carries
  # the trace id of the span it happened under, which is how a developer picks
  # one request out of five interleaved lanes. So the spans are still recorded,
  # and where they go is stated rather than left to be complained about.
  @unit
  Scenario: A process with nowhere to send traces records them anyway and says nothing
    Given a process configured with no LangWatch credentials
    When it composes its observability
    Then OpenTelemetry is still set up, so a request's lines still share a trace id
    And the SDK is told where the spans go, so it does not report the process as misconfigured

  @unit
  Scenario: A process with somewhere to send traces is left alone
    Given a process configured with a LangWatch API key
    When it composes its observability
    Then nothing stands in for the exporter it was given

  @unit
  Scenario: A process that supplies its own span processors is left alone
    Given a process that passes span processors of its own
    When it composes its observability
    Then those are the processors it gets, with nothing added

  # --- A missing optional file is not news, twice per lane ---

  # `--env-file-if-exists` announces a file it did not find, on stderr, in a
  # form no flag suppresses — and both the tsx CLI process and the child it
  # spawns parse the flag, so each lane said it twice. The overlay is written
  # by haven and absent in every non-haven run, which is the common case.
  @unit
  Scenario: A dev lane says nothing about an overlay that was never written
    Given a workspace with no portless overlay
    When a lane starts
    Then it does not mention the overlay at all

  @unit
  Scenario: The overlay is still loaded, and still last, when it is there
    Given a workspace with a portless overlay
    When a lane starts
    Then the overlay is loaded after the workspace env file, so it wins

  # --- Pre-bundling something the package does not depend on ---

  # Vite was told to pre-bundle Shiki, which `apps/ui` does not depend on: the
  # design system does. Vite answered with five "Failed to resolve dependency"
  # errors per boot, and pre-bundled none of it, so the re-optimisation the
  # entry existed to prevent happened anyway.
  @unit
  Scenario: A pre-bundled dependency is named through the package that owns it
    Given the browser application pre-bundles the syntax highlighter
    When Vite reads the dependency list
    Then every entry is one Vite can resolve
    And the highlighter is still pre-bundled at start rather than discovered later

  # --- An unreachable collector, said once ---

  # With OTEL_EXPORTER_OTLP_ENDPOINT pointing at a collector that is not
  # running, every export attempt printed a connection-refused warning through
  # Go's standard logger — a different format from every other line the service
  # prints — and the failed flush at shutdown turned into a run error and a
  # non-zero exit, so a clean Ctrl-C read as a crash.
  @unit
  Scenario: An unreachable collector is reported once and then left alone
    Given a collector that refuses every connection
    When a service exports to it repeatedly
    Then the first failure is reported
    And it says it will stay quiet until the collector answers
    And no further failure is reported

  @unit
  Scenario: A collector that starts answering is reported on again if it stops
    Given a collector that refused and then answered
    When it refuses again
    Then that failure is reported, because it is news again

  @unit
  Scenario: Export failures are reported the way every other line is
    Given a service whose exports are failing
    When a failure is reported
    Then it is written through the service's own logger, not the standard one

  @unit
  Scenario: A flush that could not reach the collector is not a failed run
    Given a service shutting down with telemetry it cannot flush
    When it stops
    Then the failure is logged as a warning
    And the service exits successfully, because nothing it was asked to do failed
