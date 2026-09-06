Feature: What we tell customers is billable matches what we bill
  As someone deciding whether LangWatch fits my budget,
  I want the short answer to "what is an event?" to name everything that costs
  me money,
  so that I can size a bill from my own workload instead of discovering the
  rest of it on an invoice.

  # Cross-references:
  #   langwatch/src/server/event-sourcing/projections/global/
  #     orgBillableEventsMeter.mapProjection.ts — the meter, and the only
  #     authority on what is billable.
  #   docs/pricing/billable-events.mdx — the full list.
  #   docs/pricing.mdx — the short answer, and the FAQ version of it.
  #
  # Context. The meter subscribes to seven event types across four families:
  # spans, evaluations, experiment runs and simulation runs. The full list page
  # names all seven. The short answers did not: the Events section offered "a
  # span within a trace, or a scenario or evaluation run", which drops
  # experiments, and the pricing FAQ offered "a span within a trace or a
  # scenario run", which drops evaluations and experiments too.
  #
  # A reader who only sees the short answer plans around spans. An experiment
  # sweep over 100 rows with 2 evaluators is roughly 301 events, so the omitted
  # families are not a rounding error on the bill.
  #
  # The short answer is not the full list and should not become it. It names
  # the four families in the customer's own words; the counting rules, the
  # per-family arithmetic and the never-billed list stay one click away.

  Rule: The short answer names every family the meter bills

    @unit
    Scenario: The Events section covers all four billable families
      Given the meter bills spans, evaluations, experiments and simulations
      When someone reads the short definition on the pricing page
      Then it names all four in plain language
      And it points at the full list for the counting rules

    @unit
    Scenario: The pricing FAQ answer covers all four billable families
      Given a reader who only opens the FAQ accordion
      When they read what counts as a billable event
      Then it names all four families rather than spans and scenarios alone

  Rule: The full list stays exactly the meter's list

    @unit
    Scenario: Every event type the meter bills appears in the documented list
      Given the meter subscribes to a fixed set of event types
      Then each one appears in the billable-events documentation
      And a newly billable event type is missing until someone documents it

    @unit
    Scenario: The documented list bills nothing the meter does not
      Given the documentation names event types customers are charged for
      Then each one is a type the meter actually subscribes to
      And a type removed from the meter stops being advertised as billable
