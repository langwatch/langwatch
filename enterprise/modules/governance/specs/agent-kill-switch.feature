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

  @integration
  Scenario: The credential that requested a stop cannot approve it
    Given a stop of "support-bot" an API key requested, pending approval
    When the same API key approves it
    Then the approval is refused with code "agent_stop_self_approval"

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
    And the audit log records only the accepted decision

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

  @integration
  Scenario: A kill switch milestone is appended to the registry feed once however often it is announced
    Given a registry agent "alpha"
    When its stop_requested milestone is announced twice at once with one event id
    Then the registry feed holds one stop_requested event carrying the stop
    And it comes after every event already in the feed

  @integration
  Scenario: Each kill switch milestone reaches the registry feed and each subscribed webhook once
    Given a webhook endpoint subscribed to "governance.agent.*"
    When a stop's stop_requested, quarantined and restored milestones are each announced twice
    Then the registry feed holds each milestone once, in order
    And the endpoint gets one delivery per milestone

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

  @unit @integration
  Scenario: A restore that races a retry is refused by the stop and the next restore reverts
    Given a stop in "stop_failed"
    When a retry and a restore are asked at the same time
    Then the stop accepts the first, refuses the other, and numbers only accepted requests
    And a later restore reverts the targets, and a rebuilt stop matches the live one

  @unit
  Scenario: The restore dialog names the stopped agents that keep a shared key disabled
    Given "Finance close" and "Sales pipeline" are stopped and share one virtual key
    When Restore is opened for "Finance close"
    Then the dialog says the virtual key stays disabled while "Sales pipeline" is still stopped

  @integration
  Scenario: A target whose cloud resource is gone counts as stopped and as restored
    Given a stop plan whose serving endpoint was deleted, so Databricks answers 404
    When the agent is stopped and later restored
    Then the stop is "quarantined" and then "restored", never "stop_failed" or "restore_failed"
    And the endpoint target is recorded as gone in the audit rows and the webhook events
    And a Bedrock ResourceNotFoundException counts as gone the same way

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
    Given a stop of "support-bot" whose restore failed on its serving endpoint
    When the serving endpoint is removed from the plan
    Then the stop is restored

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
    And an approval card for "pricing-bot" offers Approve and Deny

  @integration
  Scenario: A failing stop read shows its error and offers no action on the stop state it lacks
    Given the reads of the agents' stops and of the stops waiting for approval fail with a server error
    When a person with governance:manage opens the Agents page
    Then the page says the stop state and the stops waiting for approval did not load, each with Try again
    And no agent row shows a stop status or offers Stop, Restore or Retry
    And no approval card offers Approve or Deny
    And a stop read that fails after it answered drops the stop state it showed

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
