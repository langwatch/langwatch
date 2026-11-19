Feature: Agent kill switch: stop a misbehaving agent where it runs, with approval and restore

  A governance team stops an agent of its registry on the platform the agent runs on. Each agent
  holds a stop plan: the targets a stop acts on. A target is a Databricks model serving endpoint
  (stopped through the workspace a Databricks governance source connects), an Amazon Bedrock agent
  alias (set to reject invocations through an AWS connection the organisation stored) or a
  LangWatch gateway virtual key the agent's model calls go through (disabled).
  A stop is a fact: the request, the approval or denial and every target's outcome are events on the
  stop's own aggregate. The worker applies each target from a process manager, idempotent and
  retried; nothing sweeps on a timer. A stop is immediate when its severity is critical or when a
  person holding governance:manage presses Stop; any other stop waits for an approval.
  Restore reverts only the targets the stop applied. Every request, decision, quarantine and
  restore writes an audit log row and pushes a governance.agent.* webhook event.
  The kill switch is an Enterprise feature, behind the AGENT_REGISTRY entitlement like the registry.
  Docs: docs/governance/kill-switch.mdx

  Background:
    Given an Enterprise organisation whose registry holds the agent "support-bot"

  # Stop plan

  @integration
  Scenario: A stop plan holds a Databricks serving endpoint, a Bedrock agent alias and a virtual key
    Given a Databricks governance source and an AWS connection in the organisation
    When a person with governance:manage sets the plan of "support-bot" to a serving endpoint "support-bot-prod", the Bedrock alias "AGENT00001/ALIAS00001" in "eu-west-1" and a virtual key of the organisation
    Then the plan of "support-bot" lists the three targets

  @integration
  Scenario: An agent with no stop plan yet still offers its kill switch actions
    Given "support-bot" has no stop plan and no stop
    When the Agents page reads the kill switch summaries
    Then "support-bot" has a summary with no plan targets and no open stop

  @integration
  Scenario: A stop plan naming a virtual key of another organisation is refused
    When the plan of "support-bot" names a virtual key the organisation does not hold
    Then the write is refused with code "agent_stop_target_invalid"

  @integration
  Scenario: A stop plan naming a Databricks source that is not Databricks is refused
    When the plan names a Copilot Studio source for a serving endpoint target
    Then the write is refused with code "agent_stop_target_invalid"

  @integration
  Scenario: A stop plan naming a target its platform does not find is refused
    When the plan names a serving endpoint its workspace answers 404 for, or a Bedrock alias AWS does not find
    Then the write is refused with code "agent_stop_target_not_found" naming the target's position
    And a platform failing for another reason lets the plan save

  @unit
  Scenario: Adding and removing an AWS connection is audited without its secrets
    Given a person with "governance:manage"
    When they add an AWS connection with an access key pair and then remove it
    Then the audit log records "governance.agent.aws_connection_created" and "governance.agent.aws_connection_deleted" with the connection as the target and the person as the actor
    And neither row holds the secret access key or the external id

  @unit
  Scenario: An AWS connection stores its secret key encrypted and never answers it
    When a person with governance:manage stores an AWS connection with an access key pair
    Then the stored row holds the secret access key encrypted
    And reading the connection answers the access key id's last four characters and no secret

  @unit
  Scenario: An AWS connection may name a role to assume instead of a key pair
    When a person stores an AWS connection with only a role ARN and an external id
    Then the connection is stored with no key pair

  @integration
  Scenario: Two plan writes at once leave one whole plan
    Given two people save a stop plan for "support-bot" at the same moment
    When both writes commit
    Then the plan holds the targets of exactly one write

  @integration
  Scenario: A plan saved over one someone else saved since is refused
    Given two people read the stop plan of "support-bot" at the same version
    And the first saves it
    When the second saves it with the version they read
    Then the save is refused with code "agent_stop_plan_conflict"
    And the plan keeps the first person's targets and version

  @integration
  Scenario: Deleting an AWS connection and saving a plan that names it never interleave
    Given an AWS connection no plan names yet
    When its delete and a plan save naming it run at the same moment
    Then either the delete is refused with code "governance_aws_connection_in_use"
    Or the plan save is refused with code "agent_stop_target_invalid"

  @integration
  Scenario: A plan save checks its platforms before it takes the agent's lock
    Given a plan save for "support-bot" is waiting on a slow platform answer
    When a person stops "support-bot" meanwhile
    Then the stop goes through without waiting for the plan save
    And the plan save then commits under the agent's lock, refused if the plan moved past its version

  @unit
  Scenario: An AWS connection a stop plan or an unrestored stop still uses cannot be deleted
    Given a stop plan target or a stop that is not restored yet signs with an AWS connection
    When the connection is deleted
    Then the delete is refused with code "governance_aws_connection_in_use"
    And the connection is kept until the plan drops it and the stop is restored

  # Request and approval

  @integration
  Scenario: A person with governance:manage pressing Stop stops at once
    Given "support-bot" has a stop plan
    When a person with governance:manage requests a stop from the UI
    Then a stop is requested with approval "immediate"
    And every target of the plan is applied

  @integration
  Scenario: A critical stop from a machine credential stops at once
    Given "support-bot" has a stop plan
    When an API key with governance:manage requests a stop with severity "critical"
    Then every target of the plan is applied without waiting for an approval

  @integration
  Scenario: A non-critical stop from a machine credential waits for an approval
    Given "support-bot" has a stop plan
    When an API key with governance:manage requests a stop with severity "high"
    Then the stop's status is "pending_approval"
    And no target is applied
    And one "governance.agent.stop_requested" event is pushed to subscribed webhook endpoints

  @integration
  Scenario: Approving a pending stop applies its targets
    Given a stop of "support-bot" pending approval
    When a person with governance:manage approves it
    Then every target of the plan is applied

  @integration
  Scenario: Denying a pending stop applies nothing
    Given a stop of "support-bot" pending approval
    When a person with governance:manage denies it
    Then the stop's status is "denied" and no target is applied

  @integration
  Scenario: A decision on a stop that is no longer pending is refused
    Given a stop of "support-bot" that was approved
    When it is approved or denied again
    Then the decision is refused with code "agent_stop_not_pending"
    And a decision that read the stop as pending before a plan edit closed it is refused the same way
    And the audit log records it only as a refused attempt

  @integration
  Scenario: The credential that requested a stop cannot approve it
    Given a stop of "support-bot" an API key requested, pending approval
    When the same API key approves it
    Then the approval is refused with code "agent_stop_self_approval"

  @integration
  Scenario: The person who owns the requesting API key cannot approve its stop
    Given a stop of "support-bot" an API key requested, pending approval
    When the key's owner approves it from the UI, or with another key they own
    Then the approval is refused with code "agent_stop_self_approval"

  @integration
  Scenario: An approval confirmed against targets that changed since is refused
    Given a reviewer read a pending stop of "support-bot" and its targets
    And a plan edit dropped one of those targets from the stop since
    When the reviewer approves it with the target ids they read
    Then the approval is refused with code "agent_stop_plan_changed"
    And the stop is still pending approval

  @integration
  Scenario: A second stop while one is open is refused
    Given a stop of "support-bot" that is pending, stopping or quarantined
    When another stop of "support-bot" is requested
    Then the request is refused with code "agent_stop_already_open"

  @integration
  Scenario: Two stop requests at the same moment open one stop
    Given "support-bot" has no open stop
    When three stop requests for "support-bot" arrive at the same moment
    Then exactly one stop is opened
    And the other requests are refused with code "agent_stop_already_open"

  @integration
  Scenario: A stop confirmed against a plan that changed since is refused
    Given a person read the stop plan of "support-bot"
    And the plan was saved again since
    When the person confirms the stop with the target ids they read
    Then the stop is refused with code "agent_stop_plan_changed"
    And no stop is requested

  @integration
  Scenario: Concurrent decisions on one pending stop accept only the first
    Given a stop of "support-bot" pending approval
    When one reviewer approves it while another denies it
    Then one decision is accepted and the other is refused with code "agent_stop_not_pending"
    And the audit log records only the accepted decision as a decision, and the other as a refused attempt

  @integration
  Scenario: A stop request whose send failed unclearly keeps the agent's claim
    Given sending a stop request of "support-bot" fails without a known cause
    When another stop of "support-bot" is requested right after
    Then it is refused with code "agent_stop_already_open"

  @integration
  Scenario: A stop request refused before it was sent gives the claim back
    Given sending a stop request of "support-bot" is refused before it is queued
    When another stop of "support-bot" is requested right after
    Then the new stop is requested

  @unit
  Scenario: A sent stop keeps its agent's claim however long the worker lags
    Given a stop request was sent and the worker has not folded it yet
    When another stop of the agent is requested long after
    Then it is refused with code "agent_stop_already_open"

  @integration
  Scenario: A claim marked sent is never taken over as abandoned
    Given a request's claim is old enough to count as abandoned
    And its request is marked sent before another request takes the claim over
    Then the takeover is refused and the sent stop keeps its claim

  @integration
  Scenario: A decision left by a process that died before sending it is taken over once abandoned
    Given a decision on a pending stop was taken and its command never landed
    When another decision arrives before the first is abandoned
    Then it is refused
    When another decision arrives after the first is abandoned
    Then it takes the decision
    And the first process's late release or sent mark leaves the new decision in place

  @integration
  Scenario: A sent decision is never taken over as abandoned
    Given a decision on a pending stop was taken and its command was sent
    When another decision arrives long after the first would count as abandoned
    Then it is refused with code "agent_stop_not_pending"

  @unit @integration
  Scenario: A kill switch milestone is pushed to each subscribed webhook and written to no registry feed
    Given webhook endpoints subscribed to "governance.agent.*", to "governance.agent.quarantined" and to "gateway.*"
    When a stop's stop_requested, quarantined and restored milestones are announced
    Then each milestone records one delivery for each endpoint subscribed to it, carrying the registry entry and the stop
    And the registry feed, the agent's versions and its undelivered events hold no milestone
    # Released readers refuse an event type they do not know; milestones join the feed once tolerant readers have shipped.

  @unit
  Scenario: A redelivered kill switch milestone is pushed once
    Given a webhook endpoint subscribed to "governance.agent.*"
    When one milestone is announced twice at once with one event id, then once more
    Then the registry's outbox holds one delivery for that milestone and endpoint
    And every announcement carries the moment the milestone was reached as occurred_at, not when it ran
    And an announcement where no outbox runs is refused, so its intent is retried rather than lost

  @integration
  Scenario: The stop listing pages through every stop with a cursor
    Given the organisation holds four stops
    When GET /api/governance/agent-stops is read with limit 3
    Then it answers the three latest stops and a next_cursor
    When the next_cursor is passed back as cursor
    Then it answers the last stop and a null next_cursor
    And a cursor the listing never returned is refused with a validation error
    And a cursor whose position is not a timestamp is refused with a validation error

  @integration
  Scenario: Every pending approval is answered, however many there are
    Given more stops wait for a decision than the service reads at a time
    When the pending approvals are read
    Then every pending stop is answered

  @integration
  Scenario: A stop of an agent with no stop plan is refused
    Given "support-bot" has no stop plan
    When a stop is requested
    Then the request is refused with code "agent_stop_plan_empty"

  @integration
  Scenario: A stop of an agent outside the registry is refused
    When a stop is requested for an agent id the organisation's registry does not hold
    Then the request is refused with code "agent_registry_entry_not_found"

  # Applying the targets

  @integration
  Scenario: A Databricks serving endpoint target stops the endpoint through its workspace
    Given a stop plan with the serving endpoint "support-bot-prod" of a Databricks source
    When the stop is applied
    Then the workspace is asked POST "/api/2.0/serving-endpoints/support-bot-prod/config:stop" with the source's token

  @integration
  Scenario: A Bedrock agent alias target rejects invocations, keeping the alias's name and routing
    Given a stop plan with the Bedrock alias "ALIAS1" of agent "AGENT1"
    When the stop is applied
    Then the alias is read and updated with aliasInvocationState "REJECT_INVOCATIONS"
    And the update carries the alias's own name and routing configuration

  @unit
  Scenario: A Bedrock alias in an invocation state LangWatch does not know is refused
    Given Bedrock answers an alias whose aliasInvocationState is neither accepting nor rejecting
    When the alias's state is read
    Then the read is refused with code "bedrock_alias_state_unknown"
    And no update is sent

  @integration
  Scenario: A virtual key target disables the key with the stop's reason
    Given a stop plan with a virtual key
    When the stop is applied
    Then the gateway disables the key with a reason naming the stop

  @integration
  Scenario: All targets applied quarantine the agent
    Given a stop being applied to three targets
    When the last target is applied
    Then the stop's status is "quarantined"
    And one "governance.agent.quarantined" event is pushed carrying every target's outcome
    And the audit log records "governance.agent.quarantined" for the agent

  @integration
  Scenario: A target the platform refuses is retried, then recorded as failed
    Given a stop whose Bedrock target answers an error on every attempt
    When the worker spends the target's attempts
    Then the target is recorded failed with the platform's error code
    And the stop's status is "stop_failed" once the other targets settle
    And one "governance.agent.stop_failed" event is pushed

  @integration
  Scenario: A redelivered apply intent stops each target once
    Given a target's apply intent delivered twice
    When the worker runs both deliveries
    Then the target's applied event is recorded once

  @integration
  Scenario: A retried apply after a successful platform call still counts the change as the stop's own
    Given the stop disabled the virtual key and set the Bedrock alias to reject invocations
    And the apply intents are delivered again before their outcome was recorded
    Then the redelivery finds the virtual key disabled and does not call the gateway again
    And a gateway refusal on the redelivery does not record the target failed
    When the stop is restored
    Then the virtual key is enabled and the Bedrock alias accepts invocations again

  @integration
  Scenario: An outcome whose first record fails is recorded on a later delivery
    Given a target's platform call succeeds but recording its outcome fails on every platform attempt
    When the worker delivers the intent again past the platform attempt budget
    Then the outcome is recorded and the stop settles

  # Restore

  @integration
  Scenario: A target already stopped before the stop is left as it was on restore
    Given the virtual key of "support-bot" is already disabled and its Bedrock alias already rejects invocations
    When a person stops "support-bot" and later restores it
    Then the stop records both targets applied without changing them
    And the restore leaves the virtual key disabled and the Bedrock alias rejecting invocations
    And the serving endpoint is stopped and started again

  @integration
  Scenario: Restore reverts only the targets the stop applied
    Given a stop in "stop_failed" whose virtual key target failed and whose other targets were applied
    When a person with governance:manage restores the agent
    Then the serving endpoint is started again with POST "/api/2.0/serving-endpoints/support-bot-prod/config:start"
    And the Bedrock alias is updated with aliasInvocationState "ACCEPT_INVOCATIONS"
    And the virtual key is not enabled
    And the stop's status is "restored" and one "governance.agent.restored" event is pushed

  @integration
  Scenario: A target that cannot be reverted leaves the stop restore failed
    Given a stop in "stop_failed" whose serving endpoint answers an error on start
    When the agent is restored and the attempts are spent
    Then the stop's status is "restore_failed" and one "governance.agent.restore_failed" event is pushed

  @integration
  Scenario: Restoring one agent keeps a virtual key another stopped agent shares disabled
    Given "support-bot" and "sales-bot" are both quarantined and their plans share one virtual key
    When "support-bot" is restored
    Then the key stays disabled and its target is recorded as kept disabled
    When "sales-bot" is restored
    Then the key is enabled again

  @integration
  Scenario: Restoring one agent keeps a serving endpoint and a Bedrock alias another stopped agent shares stopped
    Given "support-bot" and "sales-bot" share one serving endpoint and one Bedrock alias
    And "sales-bot" names the endpoint through another Databricks source of the same workspace
    When both are stopped
    Then each stop records the endpoint and the alias as its own change, never as already stopped
    When "support-bot" is restored
    Then the endpoint is not started, the alias still rejects invocations, and both targets are recorded as kept disabled
    When "sales-bot" is restored
    Then the endpoint is started and the alias accepts invocations again

  @integration
  Scenario: A stop waiting for approval does not keep a shared virtual key disabled
    Given "support-bot" is quarantined and a machine credential's stop of "sales-bot" waits for approval
    And their plans share one virtual key
    When "support-bot" is restored
    Then the key is enabled again
    When the "sales-bot" stop is denied, the key stays enabled
    When the "sales-bot" stop is approved instead, the key is disabled and its restore enables it

  @integration
  Scenario: A stop that finds a shared key left disabled by a closed stop owns it
    Given a restore kept a shared virtual key disabled for a stop that then dropped the key
    When the agent is stopped again
    Then the stop records the key as its own change, not as already stopped
    And restoring it enables the key

  @integration
  Scenario: A stop that finds a shared target off while another stop is letting it go owns it
    Given "support-bot" and "sales-bot" share one Bedrock alias, and restoring "support-bot" kept it off for "sales-bot"
    And restoring "sales-bot" then failed on the alias
    When "ops-bot", whose plan names the alias too, is stopped
    Then the stop records the alias as its own change, not as already stopped
    And restoring "sales-bot" again keeps the alias off until "ops-bot" is restored
    And a virtual key whose only holder's restore failed is taken over the same way

  @unit @integration
  Scenario: A restore that races a retry is refused by the stop and the next restore reverts
    Given a stop in "stop_failed"
    When a retry and a restore are asked at the same time
    Then the stop accepts the first, refuses the other, and numbers only accepted requests
    And a later restore reverts the targets, and a rebuilt stop matches the live one

  @unit @integration
  Scenario: The restore dialog names the stopped agents that keep a shared target off
    Given "Finance close" and "Sales pipeline" are stopped and share one virtual key
    When Restore is opened for "Finance close"
    Then the dialog says the virtual key stays disabled while "Sales pipeline" is still stopped
    And it names "Sales pipeline" even when no Agents page row backs that agent
    When they share a serving endpoint of one Databricks source instead
    Then the dialog says the serving endpoint stays stopped while "Sales pipeline" is still stopped
    When they share a Bedrock alias, whichever AWS connection each names it through
    Then the dialog says the Bedrock alias stays off while "Sales pipeline" is still stopped
    And a target that is already reverted, or a different one, names no one

  @integration
  Scenario: A target whose cloud resource was deleted after the stop counts as restored
    Given a quarantined stop whose serving endpoint was deleted since, so Databricks answers 404
    When the agent is restored
    Then the stop is "restored", never "restore_failed"
    And the endpoint target is recorded as gone in the audit rows and the webhook events

  @integration
  Scenario: A target its platform does not find on the stop's first call fails as target_not_found
    Given a stop plan whose serving endpoint answers 404 and whose Bedrock alias answers ResourceNotFoundException
    When the agent is stopped
    Then both targets are recorded failed with code "target_not_found", not as gone
    And the stop is "stop_failed", so a wrong region, account or id never reads as quarantined

  @integration
  Scenario: A second restore retries the reverts the first one could not do
    Given a stop in "restore_failed" whose serving endpoint start failed
    And the serving endpoint starts again
    When the agent is restored a second time
    Then the restore is round 2, the endpoint is started again and the stop's status is "restored"
    And one "governance.agent.restored" event is pushed and audited

  @unit
  Scenario: A late outcome of an earlier restore changes nothing
    Given a stop in its second restore with a target reverting
    When a revert outcome of the first restore arrives for that target
    Then the stop is unchanged
    And the second restore's own outcome still settles it

  @integration
  Scenario: A stop row whose targets column does not match its schema is refused
    Given a stored stop whose targets column holds a round that is not a number
    When the stop is read
    Then the read fails instead of reading the round as 0

  @unit
  Scenario: An AWS connection write commits only together with its audit row
    Given the audit outbox refuses the next append
    When an AWS connection is added or deleted
    Then the write is refused and nothing changes
    And a retry commits the write together with its audit row

  @unit
  Scenario: A kill switch audit row is written through the outbox, once per key
    Given the audit outbox is connected
    When an AWS connection is deleted
    Then its audit intent is appended to the outbox under a key minted at the request
    And delivering that intent twice writes one audit row

  @integration
  Scenario: A redelivered milestone writes one audit row
    Given a quarantined stop whose milestone was announced and audited
    When the same milestone announcement is delivered again
    Then the audit log holds one "governance.agent.quarantined" row

  @unit @integration
  Scenario: A milestone audit row is stamped with the moment its milestone was reached
    Given a stop whose restore was asked at one moment and failed later
    When its "governance.agent.restore_failed" milestone is audited
    Then the row is stamped with the moment the restore failed, not the latest moment the stop recorded
    And the webhook's occurred_at carries that same moment, both to the millisecond
    And a redelivered announcement of it names the same row

  @unit @integration
  Scenario: A request and the milestone it causes list in causal order, even in one second
    Given a stop whose restore or retry was asked
    When the milestone it causes is reached in the same second as the request
    Then the request's audit row is dated at the moment it was asked, to the millisecond
    And the milestone's row is dated after it, at least one millisecond later
    And the audit log, newest first, lists the milestone above the request that caused it

  @integration
  Scenario: Restoring a stop that is not quarantined is refused
    Given a stop of "support-bot" pending approval
    When it is restored
    Then the restore is refused with code "agent_stop_not_restorable"

  @integration
  Scenario: A restore acts as the credential that asked for it
    Given a person stopped "support-bot"
    When an API key with no owner restores it
    Then the gateway enables the virtual key as the key's service principal

  @integration
  Scenario: A stop acts as the credential that decided it
    Given an API key with an owner requested a stop of "support-bot" that waits for an approval
    When an API key with no owner approves it
    Then the gateway disables the virtual key as the approving key's service principal

  # Retry and plan changes

  @integration
  Scenario: A failed stop is retried on the targets it did not stop
    Given a stop of "support-bot" that ended stop_failed because the serving endpoint answered 503
    And the serving endpoint stops again
    When a person with governance:manage retries the stop
    Then only the serving endpoint is called again
    And the stop is quarantined
    And a "governance.agent.quarantined" event is pushed and a "governance.agent.stop_retried" audit row is written

  @integration
  Scenario: A retry that fails again announces the failure again
    Given a stop of "support-bot" that ended stop_failed
    When it is retried and the serving endpoint still answers 503
    Then the stop is stop_failed again
    And a second "governance.agent.stop_failed" event is pushed with an event id of its own

  @integration
  Scenario: A stop whose restore failed can be stopped again
    Given a stop of "support-bot" whose restore failed because the serving endpoint refused to start
    When the stop is retried
    Then the virtual key and the Bedrock alias are stopped again
    And the stop is quarantined

  @integration
  Scenario: Stopping a quarantined agent again applies the targets added to its plan
    Given a quarantined stop of "support-bot" whose plan gained a serving endpoint since
    When the stop is retried
    Then only the serving endpoint is stopped
    And the stop is quarantined with the three targets

  @integration
  Scenario: Only a quarantined or failed stop can be retried
    Given a stop of "support-bot" pending approval
    When it is retried
    Then the retry is refused with code "agent_stop_not_retryable"

  @integration
  Scenario: The REST route retries a stop
    Given a quarantined stop of "support-bot"
    When an API key with governance:manage posts to its retry route
    Then the route answers 202 with the stop

  @unit
  Scenario: A late outcome of an earlier run changes nothing after a retry
    Given a failed stop that was retried
    When an apply outcome of the first run arrives
    Then the stop is unchanged, and the retry's own outcome settles it

  @integration
  Scenario: A failed target removed from the plan no longer fails the stop
    Given a stop of "support-bot" that ended stop_failed on its serving endpoint
    When the serving endpoint is removed from the plan
    Then the stop drops the serving endpoint and is quarantined

  @integration
  Scenario: A target removed from the plan no longer holds a failed restore
    Given a stop of "support-bot" whose restore failed on its serving endpoint, since deleted
    When the serving endpoint is removed from the plan
    Then the drop reverts it again, finds it gone, and the stop is restored

  @unit @integration
  Scenario: A target the stop changed is reverted when the plan drops it
    Given a quarantined stop of "support-bot"
    When its plan is saved without the virtual key
    Then the virtual key is enabled again and leaves the stop once reverted
    And the stop stays quarantined on its other targets, and its restore leaves the key alone

  @unit @integration
  Scenario: A restore asked while a drop's revert is redelivered still settles that revert
    Given a quarantined stop whose plan dropped the virtual key, and the key's revert is redelivered
    When a restore is asked before the redelivered revert runs
    Then the redelivered revert still enables the key and the key leaves the stop
    And the stop is "restored", never left "restoring" on the dropped key

  @unit
  Scenario: An apply in flight for a dropped target is reverted once it lands
    Given a stop whose virtual key apply is in flight
    When the plan drops the virtual key
    Then the apply's outcome is kept, and the key is reverted once the apply lands
    And a dropped target that was already stopped, or whose apply never ran, leaves at once

  @unit @integration
  Scenario: A stop whose plan lost every target closes as restored
    Given a quarantined stop, or a stop waiting for approval
    When the plan drops every target and what the stop changed is reverted
    Then the stop is "restored", never "quarantined" with nothing stopped
    And it announces and audits "governance.agent.restored", and a new stop of the agent is accepted

  @integration
  Scenario: An apply for a target the plan no longer holds is recorded failed
    Given an approved stop whose virtual key left the plan before its apply ran
    When the apply runs
    Then the key is not called and the target is recorded failed with code "target_not_in_plan"

  @integration
  Scenario: A restore or retry answers what the stop accepted, however far the worker lags
    Given a quarantined stop and a worker that has not folded anything sent since
    When a restore is asked and then a retry, or both at the same moment
    Then only one is sent, its answer names its request id as "lastRequestId"
    And the other is refused at once as the stop itself would refuse it

  @integration
  Scenario: A retry with nothing new to apply is counted once, however far the worker lags
    Given a quarantined stop whose plan gained nothing since it was stopped
    When it is retried, once or twice before the worker folds any retry
    Then the stop counts each retry once, as its event log does
    And a later retry still applies the target its plan gained and quarantines the agent

  @integration
  Scenario: Key work never runs after its lock may have ended
    Given the lock around a shared virtual key is near the end of its transaction
    When the stop would disable the key
    Then the key is not called and the target is recorded failed

  @integration
  Scenario: Key work never runs after a lock it waited for may have ended
    Given a holder waited for the lock around a shared virtual key while another held it
    When its locked work runs
    Then its signal aborts before the transaction can lapse, counting the time it waited

  @integration
  Scenario: A retried intent of an older round leaves the platform alone
    Given a stop of "support-bot" that was restored, and a newer stop of "support-bot" that is quarantined
    When the older stop's revert and apply intents run again
    Then no platform is called and every target stays as the newer stop set it

  @integration
  Scenario: Two restores of stops sharing a virtual key enable it
    Given "support-bot" and "sales-bot" are quarantined and share one virtual key
    When "support-bot" reverts the key while "sales-bot" is being restored
    Then the key is enabled, so restoring both at once never leaves it disabled

  @integration
  Scenario: Removing a target from the plan drops it from the open stop
    Given a quarantined stop of "support-bot"
    When its plan is replaced over REST without the virtual key
    Then the open stop no longer holds the virtual key

  @integration
  Scenario: A new stop reads back as soon as its 202 returns
    When an API key requests a stop of "support-bot" that waits for an approval
    Then the latest stop of "support-bot" is that stop right after the 202
    And another key approves it right after the 202

  # Audit

  @integration
  Scenario: A refused kill switch write is still audited
    Given the kill switch calls leave the generic audit trail out, because the service writes their rows
    When a request, a decision, a restore, a retry or an AWS connection delete is refused, such as a self-approval
    Then the audit log records the action that was asked with the refusal's code as its error, and who asked
    And the row names the agent as its target whenever the agent or its stop is known

  @integration
  Scenario: Saving a stop plan writes one audit row naming the agent
    When a stop plan of "support-bot" is saved from the governance UI or over REST
    Then the audit log records one "governance.agent.stop_plan_set" row with "support-bot" as its target and who saved it
    And no generic row is written beside it, and a refused save records that row with the refusal's code

  @integration
  Scenario: An impersonated kill switch write names the operator in its audit row
    Given an operator impersonating a person in the governance UI
    When the person's stop request or AWS connection write is audited
    Then the row names the person as the actor and the operator as "actorUserId" and "metadata.impersonatorId", as the generic trail does

  @integration
  Scenario: Request, approval, denial and restore each write an audit row
    When a stop of "support-bot" is requested, approved and later restored
    Then the audit log records "governance.agent.stop_requested", "governance.agent.stop_approved", "governance.agent.quarantined", "governance.agent.restore_requested" and "governance.agent.restored" with the agent as target

  # Routes and permissions

  @integration
  Scenario: A machine credential stops an agent over REST
    Given an organisation API key holding governance:manage
    When POST /api/governance/agents/{agentId}/stop is asked with severity "critical" and a reason
    Then the response is 202 with the stop and approval "immediate"

  @integration
  Scenario: The REST stop route refuses a key without governance:manage
    Given an organisation API key holding only governance:view
    When POST /api/governance/agents/{agentId}/stop is asked
    Then the response is 403

  @integration
  Scenario: The REST stop routes refuse an organisation below the Enterprise plan
    Given an organisation on another plan with a key holding governance:manage
    When it calls POST /api/governance/agents/{agentId}/stop
    Then the response is 402 "enterprise_plan_required" naming the feature "AGENT_REGISTRY"

  @integration
  Scenario: The REST routes approve, deny, restore and read a stop
    Given a stop of "support-bot" pending approval
    When the key approves it over POST /api/governance/agent-stops/{stopId}/approve
    And GET /api/governance/agents/{agentId}/stop is asked
    Then the stop is answered with its targets

  @unit
  Scenario: The kill switch procedures need an Enterprise plan with the agent registry
    Given an organisation whose plan lacks the agent registry
    When a person with governance:manage stops an agent through the governance UI
    Then the stop is refused after the permission check and never reaches the application

  # Trigger rules

  @integration
  Scenario: A trace rule's webhook action can call the stop route
    Given an automation whose webhook action posts to the stop route with an API key header and severity "critical"
    When the stop route receives the automation's body
    Then the stop is recorded with trigger "api_key" and the automation's reason

  @integration
  Scenario: The documented trace rule template keeps the body valid JSON for any trigger name
    Given the trigger's name holds double quotes and a backslash
    When the automation renders the documented webhook template and posts it to the stop route
    Then the body is valid JSON and the stop's reason holds the name as written

  # Inventory

  @integration
  Scenario: The agents inventory shows a quarantined agent's status and pending approvals
    Given a stop of "support-bot" that is quarantined and a stop of "pricing-bot" pending approval
    When a person with governance:view opens the Agents page
    Then "support-bot" shows the status "Quarantined" with a Restore action
    And an approval card lists "pricing-bot" without Approve or Deny, which need governance:manage

  @integration
  Scenario: A failing stop read shows its error and offers no action on the stop state it lacks
    Given the reads of the agents' stops and of the stops waiting for approval fail with a server error
    When a person with governance:manage opens the Agents page
    Then the page says the stop state and the stops waiting for approval did not load, each with Try again
    And no agent row shows a stop status or offers Stop, Restore or Retry
    And no approval card offers Approve or Deny
    And a stop read that fails after it answered drops the stop state it showed

  @integration
  Scenario: An organisation below the Enterprise plan sees its agents with no kill switch
    Given an organisation whose plan is not Enterprise, with or without agents
    When a person with governance:manage opens the Agents page
    Then the page asks no stop read, before or after its plan is known
    And it shows no error banner, no approval card and no kill switch action on any row
    And a stop read refused with "enterprise_plan_required" reads the same way, never as an error

  @integration
  Scenario: Every agent of the Agents page gets its kill switch summary, however many there are
    Given an organisation with more agents and open stops than one read page holds
    When the Agents page reads the kill switch summaries
    Then every agent has a summary with its plan size and its open stop

  @integration
  Scenario: The Stop button asks for confirmation before stopping
    Given "support-bot" has a stop plan
    When a person with governance:manage presses Stop on the agent
    Then a dialog names the plan's targets and asks for a reason
    And confirming requests the stop

  @integration
  Scenario: Denying a pending stop from its approval card keeps the note
    Given a stop of "pricing-bot" pending approval
    When a person with governance:manage denies it from its approval card with a note
    Then the denial carries the note, trimmed, and the approvals are read again
    And a refused denial keeps the dialog open

  @integration
  Scenario: The AWS connection form adds a key pair or a role to assume
    When a person adds an AWS connection with an access key pair, or switches to a role to assume
    Then only the fields of the chosen kind are sent, trimmed

  @integration
  Scenario: The agent row menu always offers a way to stop an open stop again
    Given "support-bot" has a quarantined, stop_failed or restore_failed stop
    When a person with governance:manage opens its row menu
    Then the menu offers "Stop again" for a quarantined stop and "Retry stop" for a failed one, beside Restore

  @integration
  Scenario: A failed stop is retried from the agent row menu
    Given "support-bot" has a stop_failed stop
    When a person with governance:manage picks "Retry stop" and confirms
    Then the stop is retried

  @integration
  Scenario: The Restore dialog restores only the stop it was opened for
    Given a person opened Restore for the quarantined stop of "support-bot"
    When the agent's open stop becomes another stop before they confirm
    Then the dialog goes away and nothing is restored

  @integration
  Scenario: A late Restore completion leaves the dialog opened after it
    Given a Restore was confirmed and its stop was replaced before it completed
    And the Restore dialog was opened for the newer stop
    When the first Restore completes
    Then the dialog opened after it stays open

  @integration
  Scenario: The stop plan dialog shows a failed source or connection read with Retry
    Given the Databricks sources of the organisation fail to load
    When a person opens the stop plan of "support-bot"
    Then the dialog says the sources did not load, instead of offering none, and Retry reads them again

  @integration
  Scenario: The stop plan dialog takes no edit while a save runs
    Given a person saved the stop plan of "support-bot"
    When the save and its re-read have not finished
    Then Add target and each Remove are off
    And the plan keeps its targets

  @integration
  Scenario: The AWS connection form refuses a connection the contract would refuse
    When a person adds an access key id without its secret, or a role ARN that is not an IAM role
    Then the form says why and sends nothing

  @integration
  Scenario: The stop plan dialog offers the organisation's Databricks Genie sources
    Given a Databricks AI/BI Genie governance source in the organisation
    When a person opens the stop plan of "support-bot"
    Then the Databricks source picker of a serving endpoint target offers that source

  @integration
  Scenario: The approver sees the targets of the stop and approves exactly those
    Given a stop of "pricing-bot" pending approval with two targets
    When a person with governance:manage looks at its approval card
    Then the card names both targets
    And Approve sends the ids of the targets it shows
    And when the stop's targets changed since, the card says so, shows the targets now and approves nothing

  @integration
  Scenario: Each approval holds its own row until it settles
    Given stops of "support-bot" and "pricing-bot" pending approval
    When a person approves both and the approval of "pricing-bot" settles first
    Then Approve of "support-bot" stays busy and cannot be pressed again until its own approval settles

  @integration
  Scenario: The Restore and Retry dialogs stay open until their call settles
    Given a person confirmed Restore or Retry stop for "support-bot"
    When they press Escape before the call settles
    Then the confirm dialog stays open and Cancel is off

  @integration
  Scenario: Saving a stop plan someone else saved since shows their plan
    Given a person edits the stop plan of "support-bot"
    And someone else saves that plan first
    When the person saves
    Then nothing is overwritten, the dialog says someone else saved the plan and shows their plan

  @integration
  Scenario: The Agents page follows a stop through its read hints
    Given a stop of "support-bot" is stopping
    When the worker moves it on and its read hint arrives
    Then the Agents page reads the stop state again and shows the new status, with no timer
    And a decided stop leaves the approvals card on its hint, while a hint for another read changes nothing

  @integration
  Scenario: Approving a stop reads the stop state and the approvals again
    When a person approves a pending stop
    Then its approval card goes and its agent row shows the stop's new status

  @integration
  Scenario: Saving a stop plan reads the plan and the stop state again
    When a person saves the stop plan of "support-bot" without its targets
    Then the plan and the agents' stop state are read again, and Stop asks for a stop plan first
