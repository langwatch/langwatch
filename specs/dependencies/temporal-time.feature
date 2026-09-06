# The repository's one date and time library.
# Complements supply-chain-age-gates.feature, which owns how a new dependency
# clears the release-age gate, and oxc-toolchain.feature, which owns the lint
# rules that keep a retired dependency retired.

Feature: Date and time arithmetic runs on Temporal
  As a platform maintainer
  I want one framework-free time package built on Temporal
  So that every screen and service reads the same clock and the viewer's own time zone

  Background:
    Given the workspace package @langwatch/time exposes the date and time operations the product uses

  Rule: Relative time reads exactly as it did before

    @unit
    Scenario: The relative-time ladder prints the same words
      Given a fixed moment to read each timestamp against
      When a timestamp from thirty seconds, twelve minutes, one hour, five hours, one day, three days, ten days, forty days, six months and two years earlier is rendered as relative time
      Then each of the ten renders the same string the product printed before the move to Temporal

    @unit
    Scenario: A future timestamp still reads as a wait rather than a memory
      Given a timestamp twelve minutes after the moment it is read against
      When it is rendered as relative time with a suffix
      Then it reads "in 12 minutes"

    @unit
    Scenario: The compact ladder a table row prints is unchanged
      Given a fixed moment to read each timestamp against
      When timestamps across the minute, hour, day, week and month thresholds are rendered compactly
      Then each reads "now", "5m ago", "3h ago", "2d ago", "1w ago" and "3mo ago" as before

  Rule: Calendar arithmetic respects the viewer's time zone

    @unit
    Scenario: A calendar-day difference counts days, not elapsed hours
      Given a viewer in Europe/Amsterdam
      And two timestamps four hours apart that fall either side of local midnight
      When the calendar-day difference is taken
      Then it is one day

    @unit
    Scenario: A day added across a daylight-saving change keeps the wall-clock time
      Given a viewer in Europe/Amsterdam
      And a timestamp at 12:00 on the day before the spring clock change
      When one day is added
      Then the result reads 12:00 local time rather than 11:00 or 13:00

    @unit
    Scenario: The start of a day is local midnight, not UTC midnight
      Given a viewer in Europe/Amsterdam
      And a timestamp at 00:30 local time
      When the start of that day is taken
      Then it is the same calendar day at 00:00 local time

    @unit
    Scenario: Today and yesterday are named against the viewer's calendar
      Given a viewer in Europe/Amsterdam
      When a timestamp from late yesterday evening is grouped
      Then it is grouped as yesterday rather than as today

  Rule: Rendered date patterns are byte-identical to what the screens printed

    @unit
    Scenario: Every pattern the product uses renders unchanged
      Given the date patterns the screens pass today
      When each is rendered against a fixed timestamp
      Then the output matches the string the previous library produced, character for character

    @unit
    Scenario: An unsupported pattern fails loudly rather than printing a literal
      Given a pattern containing a token the package does not implement
      When it is rendered
      Then the call fails with an error naming the token

  Rule: The Temporal polyfill is installed once, at each entry point

    @unit
    Scenario: The polyfill module installs Temporal when the runtime has none
      Given a runtime without a global Temporal
      When the polyfill module is imported
      Then a global Temporal is present afterwards

    @unit
    Scenario: The polyfill module leaves a native Temporal alone
      Given a runtime that already provides Temporal natively
      When the polyfill module is imported
      Then the runtime's own Temporal is still the global one

    @unit
    Scenario: Each process and the browser install the polyfill at its entry
      When the API, worker, tasks and browser entrypoints are inspected
      Then each imports the polyfill module exactly once, for its side effect

  Rule: The retired library cannot come back

    @unit
    Scenario: No production file imports the retired date library
      When the workspace sources are inspected
      Then no file imports date-fns
      And no package manifest declares it

    @unit
    Scenario: The linter refuses a new import of the retired library
      Given a file that imports date-fns
      When the architecture lint runs
      Then it reports the import and says to use @langwatch/time instead

  Rule: Every form a moment arrives in reads as the same instant

    Dates no longer cross the wire as dates: the response carries an ISO string
    and the caller may hold that, an epoch millisecond count, a Date or a zoned
    value. All four name one instant, and arithmetic over any of them agrees.

    @unit
    Scenario: One moment reads the same whichever wire form carries it
      Given one instant expressed as a Date, an epoch millisecond count, an ISO string and a zoned value
      When each is read
      Then all four give the same epoch millisecond count, and reading one in two zones moves only the wall clock

    @unit
    Scenario: A date serialised as an ISO string subtracts like a Date
      Given two moments that crossed the wire as ISO strings
      When they are subtracted and compared
      Then the answers match the ones the Dates they were serialised from give

    @unit
    Scenario: A zone-less ISO string is read as the runtime reads it
      Given an ISO string carrying no zone suffix
      When it is read
      Then it names the moment the platform's own date parsing names

    @unit
    Scenario: An unreadable moment fails loudly rather than landing at the epoch
      Given a value that names no moment
      When a calculation is asked for over it
      Then the call fails rather than answering as though the moment were 1970

  Rule: Elapsed time and wall-clock time are told apart across a clock change

    @unit
    Scenario: Relative wording counts the wall clock across a clock change
      Given a span crossing the spring change in Europe/Amsterdam and the autumn change in America/New_York
      When elapsed milliseconds and wall-clock seconds are both taken
      Then the elapsed count includes the hour the clock skipped or repeated and the wall-clock count does not
