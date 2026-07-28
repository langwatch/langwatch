Feature: Repairing automations whose evaluation-state condition can never match

  An automation can be saved with an evaluation-state condition that no
  evaluation will ever report. Nothing rejects it on the way in and nothing
  reports it afterwards, so the automation sits enabled, displays its condition
  as if it were healthy, and silently never notifies anyone.

  This is the residue of issue #4805. The two code defects reported there
  already shipped (#4903, #5395); what remained was that alerts saved before
  the option list was fixed still hold the dead value, and the value is still
  saveable today.

  Two rules govern the work: already-saved automations get repaired or
  reported, and a dead value can no longer be saved on any surface. A repair
  that guesses is worse than one that reports — a wrongly-repaired automation
  turns from silent into an alert storm.

  Every scenario is tagged @unimplemented: this spec is written before the
  implementation, per the spec-first workflow. The tracking issue is #4805 —
  the implementer removes the tag from each scenario as they bind it.

  Background:
    Given a project with automations enabled
    And an evaluator whose runs report one of the known execution states

  Rule: Automations saved with a dead condition are repaired

    @integration @unimplemented
    Scenario: An automation with a dead state condition starts notifying after repair
      Given an automation configured to alert on a state value no evaluation reports
      And it has never notified despite matching evaluations occurring
      When the repair runs
      Then the automation's condition names a state that evaluations do report
      And a matching evaluation now causes it to notify

    @integration @unimplemented
    Scenario: Automations saved by either era of the product are both repaired
      Given one automation whose conditions were saved in the older stored form
      And one saved in the form the product writes today
      And both carry the same dead state value
      When the repair runs
      Then both are repaired
      And neither automation's stored form is changed by the repair

    @integration @unimplemented
    Scenario: Only the evaluation-state condition is touched
      Given an automation whose dead value appears in a different condition entirely
      And an automation whose dead value appears in an adjacent evaluation condition
      When the repair runs
      Then neither automation's conditions are altered

    @unit @unimplemented
    Scenario: A condition listing several states keeps the ones that were already valid
      Given an automation whose condition lists a dead state alongside a valid one
      When the repair runs
      Then the condition lists the repaired state and the valid one
      And no state appears twice

  Rule: A value that cannot be confidently repaired is reported, never guessed

    @integration @unimplemented
    Scenario: An unrecognised state value is left alone and surfaced
      Given an automation whose state value is not recognised
      When the repair runs
      Then its condition is unchanged
      And the run reports that automation, its project, and the offending value

    @integration @unimplemented
    Scenario: The two known ambiguous values get a stated outcome
      Given automations using each of the two legacy pass/fail state values
      When the repair runs
      Then each is either repaired to a named state or reported as unrepairable
      And neither is silently passed over

    @integration @unimplemented
    Scenario: Operators can see what the repair would do before it does it
      Given automations with a mix of repairable and unrepairable state values
      When an operator previews the repair
      Then the full set of intended changes is reported
      And no automation is modified

    @integration @unimplemented
    Scenario: A repair mapping is only applied once it is evidenced
      Given the real distribution of dead values has not been established
      When the work ships
      Then it reports what it found without rewriting any value

  Rule: The repair is safe to run, and to run again

    @integration @unimplemented
    Scenario: Running the repair twice changes nothing the second time
      Given the repair has already run
      When it runs again
      Then no automation is changed
      And the run reports that nothing needed repair

    @integration @unimplemented
    Scenario: One unreadable automation does not stop the others
      Given an automation whose stored conditions are unreadable
      And a repairable automation alongside it
      When the repair runs
      Then the repairable automation is repaired
      And the unreadable one is reported
      And the run completes

    @integration @unimplemented
    Scenario: Automations outside the repair's scope are not written at all
      Given a deleted automation and an automation with no evaluation-state condition
      When the repair runs
      Then neither is written

    @integration @unimplemented
    Scenario: A repaired automation can be restored to how it was
      Given automations that the repair modified
      When the documented reversal is applied
      Then every one of them holds exactly the conditions it held beforehand

  Rule: A dead state value can no longer be saved

    @integration @unimplemented
    Scenario Outline: Every authoring surface refuses a newly-entered dead value
      Given an operator composing an automation on <surface>
      When they save a state condition naming a value no evaluation reports
      Then the automation is not saved

      Examples:
        | surface                  |
        | the automation editor    |
        | the raw conditions editor|
        | the public API           |
        | the agent tools          |

    @integration @unimplemented
    Scenario: The refusal tells the operator what to do about it
      When a save is refused for a dead state value
      Then the operator is shown which condition was rejected
      And the value that was rejected
      And the state values they can use instead

    @unit @unimplemented
    Scenario: Every state an evaluation can report is still accepted
      When an operator saves a condition for each state evaluations report
      Then every one of them saves

    @unit @unimplemented
    Scenario: Adding a new evaluation state without updating the accepted list fails the build
      Given a new evaluation execution state is introduced
      When the project is built
      Then the build fails until the accepted list includes it

  Rule: An automation that could not be repaired stays under its owner's control

    @integration @unimplemented
    Scenario: An unrepaired automation can still be renamed, retargeted and disabled
      Given an automation whose state value was reported as unrepairable
      When its owner renames it, changes where it notifies, or disables it
      Then each of those changes is saved

    @integration @unimplemented
    Scenario: An unrepaired automation can be corrected by its owner
      Given an automation whose state value was reported as unrepairable
      When its owner changes that value to one evaluations report
      Then the change is saved

    @integration @unimplemented
    Scenario: Introducing a new dead value into that automation is still refused
      Given an automation whose state value was reported as unrepairable
      When its owner adds a further condition naming another dead value
      Then the save is refused

  Rule: Existing automation behaviour is unchanged

    @integration @unimplemented
    Scenario: A repaired automation survives the caching of active automations
      Given an automation has just been repaired
      When the next matching evaluation arrives
      Then the automation notifies on its repaired condition

    @integration @unimplemented
    Scenario: Automations with no evaluation-state condition are untouched
      Given automations whose conditions never mention evaluation state
      When they are created, updated, and evaluated against a trace
      Then they behave exactly as they did before the repair shipped

    @unit @unimplemented
    Scenario: Thumbs-down automations still require a real down-vote
      Given a thumbs-down automation
      When a trace arrives with no down-vote
      Then it does not notify

    @unit @unimplemented
    Scenario: A dead state value inside a query-style condition still never matches
      Given an automation whose subject query names a dead state value
      When an evaluation completes
      Then the automation does not notify

# --- AC Coverage Map ---
# AC1  "runs automatically on deploy everywhere"        -> Scenario: An automation with a dead state condition starts notifying after repair (delivery asserted by the run being a deploy-time migration)
# AC2  "phantom rewritten, both storage shapes"         -> Scenario: Automations saved by either era of the product are both repaired
# AC3  "scoped to the evaluations.state key only"       -> Scenario: Only the evaluation-state condition is touched
# AC4  "unrecognised value untouched and reported"      -> Scenario: An unrecognised state value is left alone and surfaced
# AC5  "succeeded/failed explicitly classified"         -> Scenario: The two known ambiguous values get a stated outcome
# AC5b "mapping evidenced before applied"               -> Scenario: A repair mapping is only applied once it is evidenced
# AC6  "mixed and duplicate-producing arrays"           -> Scenario: A condition listing several states keeps the ones that were already valid
# AC7  "preview reports without writing"                -> Scenario: Operators can see what the repair would do before it does it
# AC8  "refused on every write path"                    -> Scenario Outline: Every authoring surface refuses a newly-entered dead value
# AC9  "refusal is actionable at the user's surface"    -> Scenario: The refusal tells the operator what to do about it
# AC10 "unrepaired automation stays manageable"         -> Scenario: An unrepaired automation can still be renamed, retargeted and disabled
#                                                       -> Scenario: An unrepaired automation can be corrected by its owner
# AC10b"reject vs sanitize posture decided"             -> Scenario: Introducing a new dead value into that automation is still refused
# AC11 "canonical values save; enum change breaks CI"   -> Scenario: Every state an evaluation can report is still accepted
#                                                       -> Scenario: Adding a new evaluation state without updating the accepted list fails the build
# AC12 "malformed row skipped, run completes"           -> Scenario: One unreadable automation does not stop the others
# AC13 "idempotent"                                     -> Scenario: Running the repair twice changes nothing the second time
# AC14 "deleted / no-state-key rows not written"        -> Scenario: Automations outside the repair's scope are not written at all
# AC15 "dispatch-time settle re-check passes"           -> Scenario: An automation with a dead state condition starts notifying after repair
# AC16 "takes effect despite the trigger cache"         -> Scenario: A repaired automation survives the caching of active automations
# AC17 "filterQuery gap documented, not fixed"          -> Scenario: A dead state value inside a query-style condition still never matches
# AC18 "#4903 fail-closed behaviour unchanged"          -> Scenario: Thumbs-down automations still require a real down-vote
# AC19 "no-state-key automations unaffected"            -> Scenario: Automations with no evaluation-state condition are untouched
# AC20 "every modified row recoverable"                 -> Scenario: A repaired automation can be restored to how it was
# AC21 "proof on real data"                             -> no scenario: an observation quoted in the PR, not an executable behaviour
# AC22 "this feature file exists"                       -> satisfied by this file
