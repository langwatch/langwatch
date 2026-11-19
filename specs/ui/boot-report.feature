# Browser tracing starts only once the application has booted, so a first load that never
# draws a page reported nothing. The loading screen's own script now reports how each boot
# ended, as a `boot` span from the browser app, beside the rest of the browser telemetry.
#
# Implementation: apps/ui/vite/boot-report.ts (inline in <head>, before any module);
# the health note in apps/ui/vite/boot-splash.ts; the entry marker in apps/ui/src/main.tsx.
# Query: service.name "langwatch-app-browser", span name "boot", attribute langwatch.boot.outcome.

Feature: Every first load reports how its boot ended

  Rule: A boot that ends well is reported for sampled sessions only

    @unit
    Scenario: A page drawn in time is reported for a sampled session
      Given browser tracing is on and the session is sampled
      When the app draws its first page before the stall threshold
      Then a "boot" span is sent with outcome "drawn" and the time to the first drawn page

    @unit
    Scenario: A page drawn in time is not reported for an unsampled session
      Given browser tracing is on and the session is not sampled
      When the app draws its first page before the stall threshold
      Then nothing is sent

    @unit
    Scenario: Nothing is reported while browser tracing is off
      Given the page's config turns browser tracing off
      When the boot stalls
      Then nothing is sent

  Rule: A boot that stalls is always reported, with what it was waiting on

    @unit
    Scenario: A boot still on the loading screen after 8 seconds is reported as stalled
      Given browser tracing is on and the session is not sampled
      And the health check answered and the app's entry ran
      And the app shows its own loading screen waiting on the session
      When the loading screen is still up 8 seconds after navigation start
      Then a "boot" span is sent with outcome "stalled"
      And it names the health answer, that the entry ran, the loading screen "session", the release the page loaded and the release the server serves now

    @unit
    Scenario: A stalled boot that later draws is reported as recovered
      Given a boot that was reported as stalled
      When the app draws its first page
      Then a "boot" span with outcome "recovered" is sent in the same trace
      And the stalled span, sent first, describes the boot as it stood at the threshold

    @unit
    Scenario: A code file that failed to load is named in the report
      Given a script file failed to load during boot
      When the boot stalls
      Then the report names the file, without its address or query

    @unit
    Scenario: The report carries the path without ids or query values
      Given the page was opened at an address with an id in its path and a query
      When the boot stalls
      Then the report carries the route pattern the address matched and only the query's names

    @integration
    Scenario: The loading screen names what the workspace is waiting on
      Given the app has mounted but the workspace has not resolved
      When the app shows its loading screen
      Then the screen names what it waits on: "session", "sign-in", "organizations", "plan" or "workspace"

  Rule: A boot the person leaves is reported before the page goes

    @unit
    Scenario: A tab hidden while still loading is reported as hidden
      Given browser tracing is on
      When the page is hidden before it drew its first page
      Then a "boot" span is sent with outcome "hidden" and visibility "hidden"

    @unit
    Scenario: A page closed while still loading is reported as abandoned
      Given browser tracing is on
      When the page is unloaded before it drew its first page
      Then a "boot" span is sent with outcome "abandoned"

    @unit
    Scenario: A page the boot recovery reloads is reported as reloaded
      Given browser tracing is on
      When the boot recovery counts another attempt and the page unloads before drawing
      Then a "boot" span is sent with outcome "reloaded"

  Rule: Sending never breaks the page

    @unit
    Scenario: Without sendBeacon the report goes by a keepalive fetch
      Given the browser has no sendBeacon
      When the boot stalls
      Then the report is posted with a keepalive fetch carrying the session header

    @unit
    Scenario: A browser that can send nothing still boots
      Given the browser has neither sendBeacon nor fetch
      When the boot stalls
      Then the script raises no error

  Rule: The ingest door takes the boot report as it is sent

    @integration
    Scenario: A boot report sent as plain text is accepted
      When the boot report is posted as text/plain without a session header
      Then the door answers 202
      And the collector receives the "boot" span as the browser app
