Feature: Copying an organization's setup into another organization
  Staff stand up a demo organization from a source organization without database access or
  scripts. The copy runs on the server through each owner's API, copies an allowlist of kinds
  only, and needs one approval per organization, both live at once. Each approval names both
  organizations, and the target approval names what the copy may create there; the passkey
  signs both. Neither side gets an organization key. Module ADR-002, ADR-202.

  Background:
    Given cloud ops is on and the system flag "ops_agent_access_enabled" is on
    And Olivia's agent holds a requester key

  @unit
  Scenario: A copy side is approved alone and names the other organization
    Given a request body for "copy:source" on ACME naming Globex as the other organization
    Then it is a valid request, and so is "copy:target" on ACME naming Globex
    And a copy side without the other organization, with a second scope, or naming its own organization twice is refused as invalid
    And a request that is no copy side naming another organization is refused as invalid

  @unit
  Scenario: The copy allowlist names only setup kinds
    Then the kinds an organization copy reads are projects, evaluators, monitors, prompts and datasets
    And no kind is a secret, API key, model provider, member, role, SSO, billing, licence or usage counter

  @integration
  Scenario: A copy approval needs the organization name typed
    Given a pending request for "copy:target" on Globex naming ACME
    When Olivia approves it without typing the organization's name
    Then the approval is refused with "organization_name_mismatch"

  @integration @unit
  Scenario: The approval page shows the other organization and the target grant
    Given pending requests for "copy:source" on ACME naming Globex and "copy:target" on Globex naming ACME
    Then each approval page shows the other organization and the copy direction
    And only the target's page lists what the copy may create there: projects, evaluators, monitors, prompts and datasets
    And the passkey signs the other organization and that list, so changing either changes what is signed

  @integration
  Scenario: A copy approval mints only an ops token, never an organization key
    When the agent redeems approved "copy:source" and "copy:target" requests
    Then each answers an ops token and no organization API key
    And the server reads the source itself, so the agent never holds a key that reads ACME's traces

  @integration
  Scenario: A copy side's redeem answer lists no project of its organization
    Given ACME has a project
    When the agent redeems approved "copy:source" and "copy:target" requests and an "org:metadata" request for ACME
    Then neither copy side's answer lists a project
    And the "org:metadata" answer lists ACME's project

  @integration
  Scenario: The door answers opsCopy:create only for a session approved for copy:target
    Given redeemed "copy:target", "copy:source" and "ops:read" sessions
    Then the door permits "opsCopy:create" to the "copy:target" session and refuses it to the others

  @integration
  Scenario: A copy makes the source's projects and their setup in the target
    Given a live source approval for "copy:source" on ACME naming Globex
    And a live target approval for "copy:target" on Globex naming ACME
    And ACME has a project with an evaluator, a monitor on it, a prompt with two versions and a dataset
    When the agent copies ACME into Globex
    Then Globex has a new project with a new id and slug
    And the evaluator, the monitor, the prompt with both versions and the dataset are copied into it
    And the copied monitor is paused
    And the report says each item was copied

  @integration
  Scenario: A dry run lists what a copy would make and copies nothing
    Given live source and target approvals
    When the agent copies ACME into Globex as a dry run
    Then the report lists each item as planned
    And nothing is created in Globex

  @integration
  Scenario: A dry run is in both organizations' audit logs as a planned copy
    When the agent copies ACME into Globex as a dry run
    Then ACME's and Globex's audit logs each hold a "staffAccess.orgCopyPlanned" row with the approver and the items read

  @integration
  Scenario: A rerun copies only what is new
    Given ACME was copied into Globex once
    And ACME gained a second prompt since
    When the agent copies ACME into Globex again
    Then only the new prompt is copied
    And everything copied before reads as already copied

  @integration
  Scenario: A copy that failed after its target existed is never made twice
    Given a copy of ACME's dataset failed after the dataset was created in Globex
    When the agent copies ACME into Globex again
    Then the dataset is reported as "copy_interrupted"
    And Globex holds one copy of the dataset

  @unit
  Scenario: A copy of every project carries only live application projects
    Given ACME holds an application project, an aggregate project, a personal project and an archived project
    When a copy plans every project of ACME
    Then only the application project is planned

  @integration
  Scenario: Projects copied into an organization with no shared team share one new team
    Given Globex has no shared team
    When a copy makes three projects in Globex and a rerun makes a fourth
    Then Globex has exactly one new team
    And all four projects are in it

  @unit
  Scenario: A copied project joins the target's existing shared team
    Given Globex already has a shared team
    When a copy makes a project in Globex
    Then the project is created in that team and no new team is made

  @unit
  Scenario: A monitor whose evaluator was not copied is skipped
    Given ACME has a monitor attached to an evaluator the copy skips
    When the copy runs
    Then the monitor is skipped with "evaluator_not_copied"

  @unit
  Scenario: A project whose copy in the target was archived is not copied into again
    Given ACME's project was copied into Globex and that copy was archived since
    When a copy plans ACME again
    Then the project is skipped with "target_project_gone" and nothing in it is planned

  @unit
  Scenario: An item a concurrent run reserved first is not made twice
    Given another run reserved ACME's evaluator in Globex first
    When the copy runs
    Then the evaluator is skipped with "copied_by_a_concurrent_run" and not made

  @unit
  Scenario: A project whose copy was interrupted is skipped with everything in it
    Given an earlier run reserved ACME's project in Globex and failed before it was made
    When the copy runs again
    Then the project is skipped with "copy_interrupted"
    And nothing in it is planned or made

  @unit @integration
  Scenario: An audit row past the name cap says how many items it leaves unnamed
    Given a copy plans more items than an audit row names
    When the copy writes its audit rows
    Then each row names the first items up to the cap
    And it says the list is truncated and how many items it leaves out, which its counts still include

  @unit
  Scenario: A ledger write that fails fails the item
    Given the ledger cannot reserve an item, or cannot complete one the owner made
    When the copy runs
    Then that item is reported failed and the failure is logged
    And an item whose target was made names that target

  @unit
  Scenario: A refused item whose reservation cannot be released stays interrupted
    Given the dataset owner refuses the copy by name and the ledger cannot release the reservation
    When the copy runs and then runs again
    Then the first run reports the dataset failed with the owner's code
    And the rerun reports it skipped with "copy_interrupted"

  @unit
  Scenario: Items of a project whose copy failed are skipped
    Given the project owner fails to create ACME's project in Globex
    When the copy runs
    Then the project is reported failed
    And every item in it is skipped with "project_not_copied"

  @integration
  Scenario: A dry run skips what the target grant does not cover, as a real run would
    Given a target request whose stored grant has no "datasets:create"
    When the agent copies ACME into Globex as a dry run
    Then the dataset is skipped with "outside_copy_grant"
    And the planned-copy audit rows do not name the dataset

  @unit
  Scenario: An owner's refusal by name releases the reservation so a rerun retries the item
    Given the dataset owner refuses a copy with a handled error below 500 before it makes anything
    When the copy runs and then runs again once the owner accepts
    Then the first run reports the dataset failed with the owner's code
    And the rerun copies the dataset once

  @unit
  Scenario: Only a handled refusal below 500 counts as refused before anything was made
    Given a handled error below 500, a handled error at 500 and a plain error
    When the copy decides whether the owner made nothing
    Then only the handled error below 500 counts as refused before making

  @unit
  Scenario: A copied prompt never points at a dataset of the source organization
    Given an ACME prompt version whose demonstrations and prompting technique name ACME datasets
    When the copy reads the fields it writes into Globex
    Then the inline demonstration rows are kept
    And no dataset id or name of ACME is carried

  @unit
  Scenario: A copied prompt version carries every model setting it has and no other
    Given a prompt version with every optional model setting and its runtime parameters set, and one with none
    When the copy reads the fields it writes into the target
    Then each setting is carried with its value
    And a setting the version does not have stays absent

  @integration
  Scenario: A dataset whose copy the owner reports interrupted is kept as made and incomplete
    Given the dataset owner reports a copy of ACME's dataset interrupted after it created the dataset in Globex
    When the agent copies ACME into Globex and then again
    Then the dataset is reported as failed with "dataset_copy_incomplete" and its target
    And the rerun reports it as already copied with "dataset_copy_incomplete"
    And Globex holds one copy of the dataset

  @integration
  Scenario: Kinds a copy cannot carry yet are skipped with a reason
    Given ACME has a workflow evaluator and a monitor attached to an experiment
    When the agent copies ACME into Globex
    Then both are reported as skipped with their reason

  @integration
  Scenario: A copy writes both trails and both organizations' audit logs before it copies
    When the agent copies ACME into Globex
    Then each approval has a trail row for the copy
    And ACME's and Globex's audit logs each hold a "staffAccess.orgCopy" row with the approver, the reason and the planned items
    And the row says copied monitors are created paused

  @unit
  Scenario: A copy makes only what the target approval granted
    Given a target grant without "datasets:create"
    When a copy runs with a dataset in its plan
    Then the dataset is skipped with "outside_copy_grant" and the rest is made

  @integration
  Scenario: A copy runs on the grant stored with the request, not today's
    Given a target request whose stored grant has no "datasets:create" because it was made before a deploy added it
    When Olivia approves it and the agent copies ACME into Globex
    Then the approval page lists the stored grant, the passkey signs it, and the dataset is skipped with "outside_copy_grant"

  @integration @unit
  Scenario: A revoked approval stops a running copy
    Given a copy is running
    When Olivia revokes the source session after the evaluator was made
    Then nothing more is made and every remaining item is reported as stopped
    And the report says why it stopped
    And ACME's and Globex's audit logs each hold a "staffAccess.orgCopyStopped" row with the reason and what was made, each written on its own in up to three attempts

  @integration
  Scenario: An approval that ends between a prompt's versions stops the next version
    Given a copy is running
    When Olivia revokes the source session right after the prompt was created in Globex
    Then no later version of that prompt is written
    And the prompt is reported as failed with "prompt_versions_incomplete"
    And the stopped audit rows name the prompt

  @integration
  Scenario: An approval that ends between the last item's prompt versions still stops the copy
    Given a copy whose last item is a prompt with two versions
    When Olivia revokes the source session right after the prompt was created in Globex
    Then the prompt is reported as failed with "prompt_versions_incomplete"
    And the report says the copy stopped because the source approval ended
    And ACME's and Globex's audit logs each hold a "staffAccess.orgCopyStopped" row

  @unit
  Scenario: A stopped copy's audit rows name every target the run made
    Given a stopped run that copied a project and made a dataset whose copy then failed
    When the stopped audit rows are written
    Then they name the project and the dataset
    And they never name an item an earlier run copied

  @integration
  Scenario: A trail row that cannot be closed does not fail the copy
    Given the trail store fails to close the copy's trail rows
    When the agent copies ACME into Globex
    Then the copy answers its report with every item copied
    And the failure is logged as a warning

  @integration
  Scenario: A stop row that fails every attempt does not lose the stopped report
    Given a copy is running and Globex's audit log refuses every stop row
    When Olivia revokes the source session after the evaluator was made
    Then Globex's stop row is tried three times and then given up
    And the other organization keeps its stop row
    And the agent still gets the stopped report

  @integration
  Scenario: A failed audit write copies nothing
    Given the audit log refuses writes
    When the agent copies ACME into Globex
    Then the copy is refused with "staff_access_audit_unavailable"
    And nothing is created in Globex

  @integration
  Scenario: A copy with a source token that is no session is refused
    When the agent copies with a source ops token the server never issued
    Then the copy is refused with "staff_copy_source_invalid"

  @integration
  Scenario: A source approval that is no longer live does not pair with a new target approval
    Given the source approval's hour ran out
    And a target approval made after it
    When the agent copies ACME into Globex
    Then the copy is refused with "staff_copy_window_closed"

  @integration
  Scenario: Approvals redeemed from different addresses do not pair
    Given the agent redeemed the "copy:source" request from one address
    And it redeemed the "copy:target" request from another
    When it calls the copy
    Then the copy is refused with "staff_access_ip_mismatch"

  @integration
  Scenario: A copy whose approver is no longer a platform operator is refused
    Given both copy approvals are live
    And the operator who approved them is no longer a platform operator
    When the agent calls the copy
    Then the copy is refused with "staff_access_operator_lost" and nothing is made

  @integration
  Scenario: A copy into an organization that no longer exists is refused
    Given both copy approvals are live
    And Globex no longer exists
    When the agent calls the copy
    Then the copy is refused with "not_found" and nothing is made

  @integration
  Scenario: Approvals from different agents do not pair
    Given the source approval was made by another enrolled agent
    When the agent copies ACME into Globex
    Then the copy is refused with "staff_copy_approvals_mismatch"

  @integration
  Scenario: Each side needs its own copy scope
    Given a source approval for "ops:read" on ACME
    When the agent copies ACME into Globex
    Then the copy is refused with "staff_copy_scope_missing"
    And a target session approved as "copy:source" is refused the same way

  @integration
  Scenario: Approvals that do not name each other do not pair
    Given a source approval for "copy:source" on Globex naming Initech
    And a target approval for "copy:target" on ACME naming Globex
    When the agent copies with them
    Then the copy is refused with "staff_copy_direction_mismatch"

  @integration
  Scenario: A copy request naming one organization on both sides is refused
    When the agent asks for "copy:source" on ACME naming ACME as the other organization
    Then the request is refused with "staff_copy_same_organization"

  @integration
  Scenario: The source ops token never shows in an answer, a trail row or an audit row
    When the agent sends a copy, a malformed copy body and an unknown source token over REST
    Then no answer, trail row or audit row holds the source ops token

  @integration
  Scenario: The CLI asks one approval per organization and runs the copy
    When the agent runs "langwatch ops copy --from acme --to globex --dry-run"
    Then it requests "copy:source" on acme naming globex and "copy:target" on globex naming acme
    And it prints both approval URLs and waits for both
    And it sends the copy with the target's ops token and the source's ops token in the body
    And it ends both sessions afterwards

  @integration
  Scenario: The CLI says once that it cannot read an approval and keeps waiting
    Given the server fails the first two status reads of the source request
    When the agent runs "langwatch ops copy --from acme --to globex --dry-run"
    Then it says once on stderr that it could not read the request
    And it keeps waiting and runs the copy once the request reads approved

  @integration
  Scenario: The CLI says which copy session it could not end and fails
    Given the server refuses to end the target session after a copy
    When the agent runs "langwatch ops copy --from acme --to globex --dry-run"
    Then it names the target session as still live on stderr, with why it could not end it
    And it exits non-zero with "copy_sessions_still_live"
    And the source session is still ended

  @integration
  Scenario: The CLI stops when an organization denies its copy approval
    When the source organization denies its copy approval
    Then the CLI names the denied request, copies nothing and exits non-zero

  @integration
  Scenario: The CLI stops when an approval expires before it is decided
    When the target approval expires before anyone decides it
    Then the CLI names the expired request, copies nothing, ends the approved session and exits non-zero

  @integration
  Scenario: The CLI names a session it could not end even when the copy failed first
    Given the target approval expires before anyone decides it
    And the server refuses to end the approved source session
    When the agent runs "langwatch ops copy --from acme --to globex --format json"
    Then it exits non-zero with "copy_sessions_still_live" naming the source request
    And nothing is copied

  @integration
  Scenario: The CLI stops when a redeemed approval carries no ops token
    When redeeming an approved request answers without an ops token
    Then the CLI names that request, copies nothing and exits non-zero

  @integration
  Scenario: The CLI refuses a copy into the same organization
    When "--from" and "--to" name the same organization
    Then the CLI refuses before asking any approval and exits non-zero

  @integration
  Scenario: The CLI refuses a reason over 500 characters
    When the reason is longer than 500 characters
    Then the CLI refuses before asking any approval and exits non-zero

  @integration
  Scenario: The CLI says why a copy stopped early
    When the copy report says it stopped early and why
    Then the CLI prints that reason, ends both sessions and exits zero

  @integration
  Scenario: The CLI refuses a project list that names no project
    When the agent runs "langwatch ops copy --from acme --to globex --projects ' , '"
    Then it fails before asking any approval
    And it says to leave --projects out to copy every project

  @unimplemented
  Scenario: Scenarios and test suites are copied
    When the agent copies ACME into Globex
    Then ACME's scenarios and test suites are copied, scenarios pointing at the copied suites

  @unimplemented
  Scenario: Connected agents are copied as offline registrations
    When the agent copies ACME into Globex
    Then each connected agent is registered in Globex by name and environment, offline

  @unimplemented
  Scenario: Dashboards and their charts are copied
    When the agent copies ACME into Globex
    Then each dashboard and its charts are copied, pointing at the copied projects

  @unimplemented
  Scenario: Triggers are copied paused
    When the agent copies ACME into Globex
    Then each trigger is copied paused, with no email, Slack or webhook target firing

  @unimplemented
  Scenario: Workflows and workflow evaluators are copied
    When the agent copies ACME into Globex
    Then each workflow is copied with its latest version and its evaluator points at it

  @unimplemented
  Scenario: Traces, spans and their evaluations are copied
    When the agent copies ACME into Globex with trace data
    Then the source traces, spans and evaluation results land in the copied projects

  @unimplemented
  Scenario: Scenario runs and experiment runs are copied
    When the agent copies ACME into Globex with run data
    Then scenario runs and experiment runs land in the copied projects
