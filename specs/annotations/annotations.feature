Feature: Annotating traces

  Traces tell you what an agent did, not whether it did the right thing. That
  judgement only exists in a human's head until someone writes it down, and it
  is worth very little if it is written down as free text nobody can compare.
  Annotations give every trace a place for that judgement: a note in the
  reviewer's own words, a corrected output they wish the agent had produced,
  and values against the score metrics the project has agreed on, so the same
  question gets asked of every trace and the answers can be counted, exported,
  and turned into training or evaluation data later. Reviewers annotate where
  they already are — beside the conversation — and automated or external
  reviewers can do the same over the public API.

  Background:
    Given a project with traces
    And a reviewer with access to the project

  Rule: Reviewers record their judgement against a trace

    Scenario: A reviewer annotates a trace from the conversation
      Given a reviewer reading a trace
      When they open the annotate affordance and save a note
      Then the note is attached to that trace
      And it is shown against the trace with their name and the time they wrote it

    Scenario: A reviewer suggests what the output should have been
      Given a reviewer reading a trace whose output was wrong
      When they open the suggest affordance
      Then the current output is offered as the starting point
      And saving records their corrected output alongside the trace

    Scenario: Several reviewers annotate the same trace
      Given a trace two reviewers have both annotated
      When either of them views the trace
      Then both annotations are listed, oldest first, each attributed to its author

    Scenario: A reviewer edits their own annotation
      Given a reviewer viewing an annotation they wrote
      When they select it
      Then the annotation opens for editing with their note and scores filled in
      And saving replaces what they had written before

    Scenario: A reviewer cannot edit someone else's annotation
      Given a reviewer viewing an annotation written by a colleague
      When they select it
      Then nothing opens for editing

    Scenario: A reviewer deletes their own annotation
      Given a reviewer editing an annotation they wrote
      When they choose to delete it
      Then it is removed from the trace
      And they are told the annotation was deleted

    Scenario: A reviewer who may only read cannot annotate
      Given a reviewer whose access to the project is read-only
      When they open a trace
      Then no annotate affordance is offered

  Rule: Score metrics decide what reviewers are asked to judge

    Scenario: An operator defines a score metric for the project
      Given an operator in the project's annotation scoring settings
      When they add a metric with a name, a description, and its choices
      Then the metric is listed in the project's scoring settings
      And reviewers are offered it the next time they annotate

    Scenario: A metric offers either one choice or several
      Given an operator adding a score metric
      When they choose between the single-choice and multiple-choice styles
      Then reviewers picking a value for that metric are held to that style

    Scenario: A metric can pre-select the answer reviewers usually give
      Given an operator adding a score metric
      When they mark one of the choices as the default
      Then that choice is pre-selected for reviewers scoring against the metric

    Scenario: A metric without choices is rejected
      Given an operator adding a score metric
      When they save without entering any choice
      Then the metric is not created
      And they are told to add at least one option

    Scenario: Choices that differ only by capitalisation are rejected
      Given an operator adding a score metric with two choices spelled the same but cased differently
      When they save
      Then the metric is not created
      And they are told duplicate options are not allowed

    Scenario: A reviewer explains why they gave a score
      Given a reviewer scoring a trace against a metric
      When they add a reason alongside the value they picked
      Then the reason is kept with that score
      And it is available from the score wherever the score is displayed

    Scenario: A reviewer clears a score they had picked
      Given a reviewer who has picked a value for a metric
      When they clear it
      Then no value is recorded for that metric when the annotation is saved

    Scenario: Turning a metric off retires it without losing history
      Given a score metric reviewers have already used
      When an operator turns the metric off
      Then reviewers are no longer offered it when annotating
      And the metric is no longer a column in the annotation lists

    Scenario: Turning a metric back on offers it again
      Given a score metric that was turned off
      When an operator turns it back on
      Then reviewers are offered it again when annotating

    Scenario: Deleting a metric removes it from the project
      Given an operator viewing the project's score metrics
      When they delete a metric and confirm
      Then the metric is no longer listed
      And it is no longer offered to reviewers

    Scenario: A project with no enabled metrics points reviewers at settings
      Given a project where no score metric is enabled
      When a reviewer opens the annotation form
      Then they are told scoring metrics are disabled
      And they are offered a way to go and enable them

    Scenario: A reviewer without management rights sees the metrics read-only
      Given a reviewer who may annotate but not manage the project
      When they open the annotation scoring settings
      Then they can read the project's metrics
      And no affordance to add, edit, delete, or disable a metric is offered

  Rule: Annotations are readable wherever the trace is read

    Scenario: A publicly shared trace carries its annotations
      Given a trace that has been shared publicly and has annotations
      When someone opens the share link without signing in
      Then the trace's annotations are shown

    Scenario: Annotations left over the API are marked as such
      Given an annotation created through the public API rather than by a signed-in reviewer
      When a reviewer views the trace
      Then the annotation is shown as coming from the API
      And it is attributed to the email supplied with it, or to nobody if none was supplied

    Scenario: A thumbs rating left over the API is shown with the annotation
      Given an annotation created through the public API carrying a thumbs-up or thumbs-down rating
      When a reviewer views the trace
      Then that rating is shown alongside the note

  Rule: Everything the project has annotated can be reviewed together

    Scenario: The all-annotations view lists annotations grouped by trace
      Given a project whose traces have been annotated
      When a reviewer opens the all-annotations view
      Then each annotated trace is listed once with its input, output, and every annotation left on it

    Scenario: The view is scoped to a period
      Given a reviewer in the all-annotations view
      When they change the period
      Then only annotations made inside that period are listed

    Scenario: Trace filters narrow the annotations shown
      Given a reviewer in the all-annotations view
      When they apply trace filters
      Then only annotations on traces matching those filters are listed

    Scenario: Enabled score metrics appear as columns
      Given a project with enabled score metrics
      When a reviewer opens the all-annotations view
      Then each enabled metric has a column
      And every recorded value for it is shown against its trace

    Scenario: Notes and suggested outputs only take up room when they exist
      Given a set of annotations where nobody left a suggested output
      When a reviewer opens the all-annotations view
      Then no suggested-output column is shown

    Scenario: A reviewer exports the annotations they are looking at
      Given a reviewer in the all-annotations view
      When they export
      Then they receive a spreadsheet with, for every annotation, its author, the trace's input and output, the suggested output, the note, the trace it belongs to, its rating, its scores, and when it was made

    Scenario: A project with nothing annotated says so
      Given a project with no annotations in the selected period
      When a reviewer opens the all-annotations view
      Then they are told there is nothing yet and pointed at the documentation

    Scenario: Opening an annotated trace from the list shows the trace
      Given a reviewer in the all-annotations view
      When they select one of the listed traces
      Then that trace opens for reading

  Rule: External systems annotate over the public API

    Scenario: An unauthenticated request is refused
      Given a request to the annotations API with no credentials
      When it is made
      Then it is rejected as unauthorised
      And the response says which credential headers are accepted

    Scenario: An invalid token is refused
      Given a request to the annotations API carrying a token that does not resolve
      When it is made
      Then it is rejected as unauthorised

    Scenario: A caller lists every annotation in the project
      Given a caller whose key may read annotations
      When they list the project's annotations
      Then they receive every annotation belonging to that project and no other

    Scenario: A caller lists the annotations on one trace
      Given a caller whose key may read annotations
      When they list the annotations for a trace
      Then they receive only that trace's annotations

    Scenario: A caller fetches one annotation
      Given a caller whose key may read annotations
      When they fetch an annotation by its identifier
      Then they receive that annotation

    Scenario: An annotation from another project is not found
      Given a caller whose key may read annotations
      When they fetch an annotation identifier that does not belong to their project
      Then the response is not found

    Scenario: A caller creates an annotation on a trace
      Given a caller whose key may manage annotations
      When they create an annotation on a trace with a note and a thumbs rating
      Then the annotation is attached to that trace
      And it is returned to them

    Scenario: A caller attributes an annotation to a person
      Given a caller creating an annotation over the API
      When they supply an email address with it
      Then the annotation is attributed to that address wherever it is shown

    Scenario: An annotation without a note is rejected
      Given a caller creating or updating an annotation over the API
      When they omit the note, or send one that is not text
      Then the request is rejected as a bad request naming the note

    Scenario: An annotation without a thumbs rating is rejected
      Given a caller creating or updating an annotation over the API
      When they omit the thumbs rating, or send one that is not a true/false value
      Then the request is rejected as a bad request naming the rating

    Scenario: A caller updates an annotation
      Given a caller whose key may manage annotations
      When they update an annotation's note and rating
      Then the stored annotation reflects the new values

    Scenario: A caller deletes an annotation
      Given a caller whose key may manage annotations
      When they delete an annotation
      Then it is removed from the trace
      And the response confirms the deletion

    Scenario: A read-only key cannot write annotations
      Given a caller whose key may only read annotations
      When they attempt to create, update, or delete an annotation
      Then the request is refused

  Rule: Annotations can be worked with from the command line and by agents

    Scenario: An operator lists the project's annotations from the command line
      Given an operator with a configured API key
      When they list annotations
      Then they see each annotation's trace, note, rating, and age

    Scenario: An operator lists the annotations on one trace
      Given an operator with a configured API key
      When they list annotations for a given trace
      Then only that trace's annotations are listed

    Scenario: Annotations can be listed as machine-readable output
      Given an operator listing annotations
      When they ask for JSON output
      Then the annotations are printed as JSON rather than as a table

    Scenario: A project with no annotations suggests how to make one
      Given an operator listing annotations in a project with none
      When the list comes back empty
      Then they are told there are none and shown how to create one

    Scenario: An operator annotates a trace from the command line
      Given an operator with a configured API key
      When they create an annotation on a trace with a note and a thumbs-up or thumbs-down
      Then the annotation is attached to that trace

    Scenario: An operator deletes an annotation from the command line
      Given an operator with a configured API key
      When they delete an annotation by its identifier
      Then it is removed from the trace

    Scenario: Command-line annotation work needs a key
      Given an operator with no API key configured
      When they run any annotation command
      Then the command stops without contacting the project

    Scenario: An agent annotates a trace on the operator's behalf
      Given an agent connected to the project with an API key
      When it creates an annotation on a trace with a note and a rating
      Then the annotation is attached to that trace and visible to reviewers

    Scenario: An agent removes an annotation
      Given an agent connected to the project with an API key
      When it deletes an annotation by its identifier
      Then the annotation is removed from the trace

    Scenario: An agent without a key cannot touch annotations
      Given an agent with no API key configured
      When it attempts any annotation tool
      Then the tool refuses before contacting the project
