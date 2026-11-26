Feature: Dashboard widgets bucket and label time on the reader's clock

  As a person reading a dashboard in any time zone
  I want a widget's buckets and time labels to follow my browser's time zone
  So that recent data never looks like it is from the future and a day starts at my midnight

  # Where: the browser sends its IANA zone as `timeZone` on every widget run (tRPC
  # `analytics.lwql.query`); `POST /api/v1/query` accepts the same field. A statement opts in by
  # declaring `{dashboard_context_timezone:String}`, a reserved surface parameter like the period
  # names. The frame exposes the zone as `LW.dashboardContext.timezone` and writes labels with
  # `LW.formatTime`. A statement that does not declare the zone runs exactly as before.

  Rule: The run is bound to the reader's zone

    @unit
    Scenario: TZ01 A widget run carries the browser's time zone
      Given a reader whose browser reports the zone "America/Los_Angeles"
      When a widget on the board runs its query
      Then the request carries timeZone "America/Los_Angeles"

    @unit @integration
    Scenario: TZ02 A statement declaring the time zone is bound to the reader's zone
      Given a statement that buckets by {dashboard_context_timezone:String}
      When it runs with timeZone "America/Los_Angeles"
      Then {dashboard_context_timezone:String} is bound to "America/Los_Angeles"
      And params.dashboard_context_timezone is "America/Los_Angeles"

    @unit
    Scenario: TZ03 A browser that names no usable time zone falls back to UTC
      Given a browser whose Intl API reports no zone, or one the server would not accept
      When a widget runs its query
      Then the request carries timeZone "UTC"
      And LW.dashboardContext.timezone is "UTC"

    @unit
    Scenario: TZ04 A run that names no time zone binds UTC
      Given a statement that declares {dashboard_context_timezone:String}
      When it runs with no timeZone, as a CLI or REST caller that predates the field
      Then {dashboard_context_timezone:String} is bound to "UTC"

    @unit
    Scenario: TZ05 A statement that does not declare the time zone runs as before
      Given a saved widget whose SQL buckets with toStartOfInterval and says nothing of a zone
      When it runs with timeZone "America/Los_Angeles"
      Then no time zone is bound, its buckets stay on UTC edges and the run succeeds

  Rule: A bad time zone or declaration is refused

    @unit
    Scenario: TZ06 A time zone that is not an IANA name is refused at the door
      When a run sends timeZone "Mars/Olympus", "UTC'); DROP TABLE x; --" or "+05:00"
      Then it is refused with a validation error on timeZone and no statement reaches the store

    @unit
    Scenario: TZ07 A request that supplies the time zone as a parameter is refused
      When a run sends dashboard_context_timezone under parameters
      Then it is refused with the code "lwql_reserved_parameter_supplied"

    @unit
    Scenario: TZ08 A time zone declared with a type other than String is refused
      When a statement declares {dashboard_context_timezone:UInt32}
      Then it is refused with the code "lwql_reserved_parameter_type"

    @unit
    Scenario: TZ17 The wrong-type refusal says how to declare each mistyped name
      Given a statement that declares the time zone, a list name or a period name with the wrong type
      When the refusal is shown, for the time zone alone or with a list and a period name
      Then it says to declare the time zone as {dashboard_context_timezone:String}
      And it names the right type for every other mistyped name, and no name that was typed right
      And a supplied dashboard_context_timezone points at the request's timeZone field

  Rule: Buckets start on the reader's clock

    @integration
    Scenario: TZ09 Day buckets start at the reader's midnight, across a DST change
      Given traces at 2026-11-01 08:30 UTC, 09:30 UTC and 2026-11-02 07:59 UTC
      When a day-grain statement runs with timeZone "America/Los_Angeles"
      Then all three fall in the bucket for Nov 1 that starts at 2026-11-01 07:00 UTC
      And with timeZone "UTC" they fall in the buckets that start at midnight UTC

    @unit
    Scenario: TZ10 The completeness buckets follow the same zone
      Given a day-grain statement that declares the time zone
      When it runs with timeZone "America/Los_Angeles" over the week of a DST change
      Then completeness.buckets start at each local midnight, one of them 25 hours long

    @unit @integration
    Scenario: TZ14 Hourly buckets keep both copies of the hour the clocks go back
      Given traces at 2026-11-01 08:30 UTC and 09:30 UTC, both 01:30 on the clock in Los Angeles
      When an hour-grain statement runs with timeZone "America/Los_Angeles"
      Then they fall in two buckets, 08:00 UTC and 09:00 UTC
      And completeness.buckets list 25 hours for the local day of Nov 1, each once

    @unit @integration
    Scenario: TZ15 Hourly buckets across the night the clocks go forward
      Given traces at 2026-03-08 06:30 UTC and 07:30 UTC, 01:30 and 03:30 on the clock in New York
      When an hour-grain statement runs with timeZone "America/New_York"
      Then they fall in the buckets that start at 06:00 UTC and 07:00 UTC
      And completeness.buckets list 23 hours for the local day of Mar 8, each once

  Rule: Labels show the reader's clock

    @unit
    Scenario: TZ11 LW.formatTime writes a time on the reader's clock
      Given LW.dashboardContext.timezone is "America/Los_Angeles" and the grain is one hour
      When a widget formats the bucket "2026-11-26 00:00:00"
      Then the label is "Nov 25, 4:00 PM"

    @unit
    Scenario: TZ12 The charts library labels axes and tooltips on the reader's clock
      Given LW.dashboardContext.timezone is "America/Los_Angeles"
      When a chart from @langwatch/charts labels the bucket "2026-11-26 00:00:00"
      Then the axis reads "16:00" and the tooltip reads "Nov 25, 16:00"

    @unit
    Scenario: TZ16 A widget whose queries do not bind the time zone keeps UTC labels
      Given a reader in "America/Los_Angeles"
      And a saved widget whose queries do not declare {dashboard_context_timezone:String}
      When a chart from @langwatch/charts labels its UTC day bucket "2026-11-26 00:00:00"
      Then the axis reads "00:00" and the tooltip reads "Nov 26", not the evening before
      And LW.dashboardContext.isTimezoneBound is false, true only when a query declares the zone

    @unit
    Scenario: TZ13 Langy's widget skill buckets with the reader's zone and never hardcodes UTC
      When Langy reads the dashboard-widgets skill
      Then it shows the reader-zone bucket expression the dashboard templates use
      And it says to label with LW.formatTime and never to write UTC in a widget
