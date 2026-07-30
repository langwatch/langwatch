# See dev/docs/adr/084-contextual-slice-interpretation.md for the architectural rationale.
Feature: Contextual slice interpretation

  A human asks "what happened to this customer last night, and does it matter".
  Answering it needs 3 separable things, and this feature keeps them separable:
    - what happened: statistics over a fixed feature schema, exact and cheap
    - why: which sub-slice moved, and what changed around the same time
    - does it matter: a judgement against what normal looks like for THIS entity

  The pipeline is slice vector -> baseline -> signal -> episode -> evidence
  bundle -> interpretation. Only the last stage involves a model, and it only
  ever sees evidence the earlier stages already computed.

  Background:
    Given a tenant with at least 7 days of telemetry history
    And slice vectors are addressed by tenant, entity kind, entity id, grain and window start

  Rule: A slice vector is a fixed feature schema, and coarser grains are merges of finer ones

    @unit
    Scenario: A 1h slice is the merge of its 5m slices
      Given the 12 five-minute slices covering one hour have been computed
      When the 1h slice for that window is requested
      Then it is produced by merging those slices
      And the underlying telemetry is not re-scanned

    @unit
    Scenario Outline: Each feature kind merges by its own rule
      Given a feature of kind "<kind>" with values in 2 adjacent windows
      When the 2 windows are merged
      Then the merged value is the "<merge>" of the parts

      Examples:
        | kind         | merge                        |
        | counter      | sum                          |
        | gauge sketch | t-digest merge               |
        | distribution | vector add then renormalise  |
        | text centroid| count-weighted mean          |

    @unit
    Scenario: A feature declares a name, a kind and an extractor and nothing else
      Given a new feature is added to a family
      When the slice vector is computed
      Then the feature merges and baselines according to its declared kind
      And no merge or baseline logic is written for that feature specifically

    @integration
    Scenario: Group-bys route through the analytics table router
      Given a slice vector needs a metric grouped by a dimension
      When the extractor builds its query
      Then the table is chosen by the existing analytics routing
      And a dimension the router treats as parity-unsafe is not decomposed over

  Rule: A baseline describes what is normal for one entity, and refuses when it cannot

    @unit
    Scenario: The baseline is robust to a single extreme window
      Given an entity with a stable series and one extreme outlier window
      When the baseline is computed
      Then the location and scale are barely moved by the outlier

    @unit
    Scenario: Normal is seasonal
      Given an entity whose traffic is 10x higher on weekday mornings
      When a weekday morning window is compared to its baseline
      Then it is compared against the weekday-morning profile
      And it does not deviate

    # Without this a sustained regression becomes the new normal, the deviation
    # decays to 0, and the system quietly heals its own alert while the customer
    # is still broken.
    @unit
    Scenario: Windows inside an open episode do not feed the baseline
      Given an entity with an open episode covering the last 6 hours
      When the baseline is recomputed
      Then the windows covered by the open episode are excluded
      And the deviation for the current window is still reported

    @unit
    Scenario: Too little history refuses instead of guessing
      Given an entity with fewer observations than the minimum support
      When a signal is evaluated for it
      Then the verdict is insufficient data
      And no signal is emitted
      And the verdict is cached with a short expiry so a ramping entity is picked up within minutes

  Rule: Multiplicity is controlled, so a tick does not emit noise

    @unit
    Scenario: False-discovery control is applied per tick
      Given a tick evaluates many features across many entities
      When deviations are converted to signals
      Then the batch is corrected for multiple comparisons
      And borderline deviations that would pass a per-test threshold alone are not emitted

    @unit
    Scenario: An entity has a daily signal budget
      Given an entity has already emitted its budgeted signals today
      When a further deviation is detected
      Then it is emitted only if it displaces a smaller-magnitude signal
      And the total emitted for that entity stays within budget

  Rule: A signal names what moved, by how much, and when it started

    @unit
    Scenario: Onset comes from the change point, not from the current window
      Given a feature that stepped up at 03:10 and has been elevated since
      When a signal is emitted at 06:00
      Then its onset is reported as 03:10

    @unit
    Scenario: Signal types come from a closed vocabulary
      Given a deviation that does not correspond to any declared signal type
      When signals are emitted
      Then no signal is produced for it
      And the gap is recorded as a refusal rather than as free text

  Rule: Overlapping signals for one entity are one episode

    @integration
    Scenario: Repeated ticks over the same problem do not repeat the finding
      Given an entity with a sustained regression across many ticks
      When signals are emitted on every tick
      Then a single episode stays open
      And the finding is revised in place rather than re-emitted

    @integration
    Scenario: An episode closes when the signals stop
      Given an open episode whose signals no longer fire
      When the tick runs
      Then the episode is resolved
      And the windows it covered become eligible for the baseline again

    @integration
    Scenario: A dismissal is recorded as a label
      Given an open episode
      When a human dismisses it
      Then the episode is closed as dismissed
      And the dismissal is attributed to its signal types for precision tracking

    @unit
    Scenario: A signal type that is dismissed too often is demoted
      Given a signal type whose dismissal rate is above the demotion threshold
      When it next fires
      Then it is recorded silently
      And it does not open an episode on its own

  Rule: The evidence bundle is assembled deterministically, before any model runs

    @integration
    Scenario: A moved metric is decomposed across its sub-slices
      Given a top-line metric that rose over the window
      When the bundle is assembled
      Then each contributing sub-slice is listed with its share of the delta
      And the shares are ordered largest first

    @unit
    Scenario: Context events are ranked by proximity to onset
      Given a signal with an onset at 03:10
      And a prompt version published at 03:08
      And a model provider changed at 23:00 the previous day
      When context events are attached
      Then the prompt version publication is ranked first

    @unit
    Scenario: The bundle carries its own holes
      Given a feature that could not be baselined for lack of history
      When the bundle is assembled
      Then the refusal is included in the bundle

    @integration
    Scenario: A matching past episode is offered as precedent
      Given a past episode for the same tenant with a similar signal set and a recorded resolution
      When the bundle is assembled
      Then that episode is included as precedent
      And its resolution is included with it

    @unit
    Scenario: Cross-tenant precedent carries structure only
      Given a matching episode belongs to a different tenant
      When it is included as precedent
      Then only structural features are carried
      And no text, entity id or raw value from the other tenant is included

    @unit
    Scenario: Cross-tenant precedent needs more than one neighbour
      Given a cross-tenant match exists but fewer neighbours than the anonymity threshold
      When the bundle is assembled
      Then no cross-tenant precedent is included

  Rule: The interpretation may only say what the bundle supports

    @integration
    Scenario: An interpretation cites its evidence
      Given a bundle with signals, attribution rows and context events
      When the interpretation is produced
      Then every supporting point cites a signal, attribution row or context event from the bundle
      And it states a claim, a confidence, and the reason the confidence is not higher

    @integration
    Scenario: An interpretation offers a second reading
      Given a bundle that supports more than one explanation
      When the interpretation is produced
      Then an alternative reading is included

    @integration
    Scenario: An ungrounded number is rejected
      Given the model returns a figure that does not appear in the bundle
      When the interpretation is validated
      Then it is rejected and retried once

    @integration
    Scenario: A repeatedly ungrounded interpretation degrades to the statistics
      Given the retry is also rejected by the validator
      When the brief is rendered
      Then it renders the signals and attribution from a deterministic template
      And no model-authored prose is shown

    @integration
    Scenario: Drill-downs are chosen by the model but defined by us
      Given the model asks for more detail before interpreting
      When the request is served
      Then only pre-registered drill-downs are run
      And their results join the bundle
      And no second round of drill-downs is served

    @unit
    Scenario: A suggested action comes from the catalogue
      Given an interpretation proposes what to do next
      When the brief is rendered
      Then the action is one of the catalogued actions
      And an action outside the catalogue is dropped

  Rule: Compute is tiered, so cost tracks attention rather than tenant count

    @integration
    Scenario: Fine-grained slices are computed only for implicated entities
      Given a project-grain signal names a subset of customers
      When the tick continues
      Then slices are computed for the named customers
      And customers with no implicating signal are not computed

    @integration
    Scenario: A watchlist entity is computed regardless of signal
      Given a human has subscribed to an entity
      When the tick runs and no signal names it
      Then its slice is still computed on schedule

    @unit
    Scenario: The model runs per episode, not per slice
      Given many slices are computed in a tick and no episode opens
      When the tick completes
      Then no interpretation is requested

  Rule: Customer text never leaves the boundaries it already has

    @unit
    Scenario: Only redacted text is embedded
      Given log records carrying a PII redaction level
      When a text centroid is computed
      Then only the redacted form is embedded

    @unit
    Scenario: An embedding records which embedder produced it
      Given a text centroid is stored
      When the embedder generation later changes
      Then vectors from the previous generation are not compared against the new ones

    @unit
    Scenario: Interpretation respects tenant egress rules
      Given a tenant whose egress rules forbid the configured interpretation model
      When an episode opens for that tenant
      Then no bundle is sent to that model
      And the brief renders from the deterministic template
