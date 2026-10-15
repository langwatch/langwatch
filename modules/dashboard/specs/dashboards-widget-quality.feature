Feature: Dashboards widget quality: template widgets read the completeness report
  As a project member reading a board made from a template
  I want every number to say when it rests on part of the data, and every card to read in
  three seconds
  So that I never take missing data for a real zero, and never read a statistics lesson
  # Owner decisions: langwatch/tasks#911 "Owner asks and decisions log", section Missing data
  # and widget quality. Design source: the prototype's pass 8 (WIDGET_STANDARD.md) and its
  # pass 9 audit. The frame itself shows no traffic and missing fields: see
  # modules/analytics/specs/dashboard-widget-frame-states.feature.

  # ---------------------------------------------------------------------------
  # Sums, averages and prices
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Widget quality: a sum that misses prices reads as a lower bound
    Given a cost widget whose query reads each trace's cost
    When its completeness report finds traces with no price
    Then the total reads with a "+", such as "$830+"
    And an average or a rate never gets a "+"

  @unit
  Scenario: Widget quality: an average cost divides by the traces with a price
    Given a cost per success, per call or per resolved conversation
    Then it divides by the share of traces whose price is known
    And a model with no price never pulls the average down

  @unit
  Scenario: Widget quality: a model with no price shows its own row with a dash
    Given a cost list by model or by source
    When the completeness report names a model with no price
    Then the model has its own "no price" row with a dash for its cost, never "$0.00"

  @unit
  Scenario: Widget quality: a source with no runs reads No runs, never $0.00
    Given the "Production vs testing" widget
    When a source such as Experiments sent no traces in the period
    Then its row reads "No runs"

  # ---------------------------------------------------------------------------
  # Time series
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Widget quality: a chart draws every bucket, a count as 0 and a measure as a gap
    Given a time-series widget and its query's report of every bucket in the window
    Then a bucket with no rows reads 0 for a count
    And it is a gap for a rate, an average or a percentile, with a faint dashed line across it
    And its hover says "No data"

  @unit
  Scenario: Widget quality: a headline never reads an empty bucket
    Given a widget whose big number is the latest or the first value of a series
    Then it reads the latest or the first bucket that has a value

  @unit
  Scenario: Widget quality: a pass rate with nothing judged is a gap, never 0%
    Given a customer, topic or tool with nothing judged or called in the period
    Then its pass rate or error rate reads as a dash

  # ---------------------------------------------------------------------------
  # The card face
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Widget quality: rigour stays off the card face
    Then no figure, column or line is labelled "p95", "kappa" or "pts"
    And the widget's description says what a response time or an agreement score measures

  @unit
  Scenario: Widget quality: no generated sentence on a card face
    Given the "ship-verdict", "so-verdict", "ck-attention" and "Production vs testing" widgets
    Then the card shows figures and plain labels
    And a sentence that explains a figure is its hover or its description

  # ---------------------------------------------------------------------------
  # What a widget needs
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Widget quality: a widget lists only the needs no query can see
    Then a catalogue widget's needs name only a judge, a setting or a source to connect
    And a trace field such as cost or a conversation id is left to the query's report

  @unit
  Scenario: Widget quality: a widget over trace fields shows the frame's setup view, not its own
    Given a widget whose query reads only trace fields, such as topics or conversations
    Then the widget has no setup face of its own and stores no presence query
    And when the field is on no trace, the frame's setup view names it
