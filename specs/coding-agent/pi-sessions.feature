# pi sessions, one row per run and the pull requests it drove
#
# Implementation:
#   modules/coding-agent/contract/src/telemetry/index.ts                 (the registry a pi definition joins)
#   modules/coding-agent/contract/src/telemetry/coding-agent-definition.ts (the shape that declares pi's span roles)
#   modules/coding-agent/contract/src/coding-agent-span-admission.ts     (the session span gate)
#   modules/coding-agent/process/src/eventing/coding-agent-session-log.projection.ts (the context fold)
#   modules/coding-agent/process/src/eventing/pull-request-mapping.subscriber.ts (what a mapped session needs)
#   modules/coding-agent/process/src/services/contribute-log-facts.service.ts (the context memo the facts are stamped with)
#
# Related specs:
#   specs/coding-agent/session-aggregate.feature         , the generic session fold pi joins
#   specs/coding-agent/pi-model-calls.feature            , the per-call tokens and cost
#   specs/coding-agent/terminal-view.feature             , how a pi session reads back
#   specs/coding-agent/sessions-screen.feature           , the row a pi session becomes
#   specs/coding-agent/pull-request-linkage.feature      , how a branch finds its pull requests
#   modules/coding-agent/specs/session-git-context.feature, the terms every agent joins the context on
#   specs/ai-governance/cli-wrappers/pi-extension-install.feature, what emits pi's spans and its context record
#
# Motivation: pi is the first agent that is both span-fed and self-reporting, so
# the two things that could have been inferred are written down instead: which
# of pi's own span names plays which role in the fold, and how the repository
# and branch reach a session whose spans never carry them.
#
# Only the second one can fail silently. Pull-request linkage reads the fold
# state a session-context record wrote, not span attributes, so a pi session
# with perfect spans and no context record maps no pull requests. The join is
# on pi's own session id as a string, which is why the match and the mismatch
# are both specified below.
#
# pi exposes no hook directory, so the installed extension is what runs the
# hook: it is the only code of ours holding `pi.session.id` while the run is
# alive, and it shells out to `langwatch ingest hook pi` for the CLI to build
# and post the record. pi's row in the per-agent context table is a plugin row,
# opencode's shape exactly, see
# specs/ai-governance/cli-wrappers/session-context-hook.feature.
#
# EVERY SCENARIO HERE IS @unimplemented ON PURPOSE, and only until it binds.
# ADR-188 is accepted; none of what it describes is built. Tagging these @unit
# or @integration now would report a binding that does not exist. Each scenario
# names the tag it becomes in a comment above it, and the commit that makes one
# pass swaps that tag and adds the `@scenario "<title>"` annotation in the same
# change. A scenario still carrying @unimplemented when ADR-188 is called done
# is work that was not done.
#
# WHAT BLOCKS THESE, AS OF 2026-10-30:
#   1. NO pi DEFINITION EXISTS. CODING_AGENT_REGISTRY
#      (modules/coding-agent/contract/src/telemetry/index.ts) holds six agents
#      and none of them is pi, so nothing detects a pi span, admits one or
#      folds one. Every Rule below waits on that one definition.
#   2. THE WORKER MARKER IS UNCHOSEN. The last Rule needs something on our own
#      worker's spans to match on. ADR-188 Decision 13 marks that marker
#      UNVERIFIED: the worker exports no telemetry at all today, so it has no
#      scope name and no service name to pick. Whoever wires an exporter there
#      chooses it. Note the constraint the record found: service identity is
#      NOT passed at admission (coding-agent-span-admission.ts calls
#      detectCodingAgent with the record name and scope only), so a service
#      marker re-attributes an already admitted span rather than refusing it.
#
# The file yields no enforced scenario while that holds, so it is listed in
# LEGACY_INERT in packages/architecture-enforcer/src/tools/check-feature-parity.ts.
# The commit that binds the first scenario here deletes that line with it.

Feature: pi sessions
  pi names its spans in its own namespace, declared in
  `@earendil-works/pi-agent-core`: `pi.harness.run` is the session root and
  carries `pi.session.id`, `pi.harness.turn` sits under the run, and
  `pi.harness.tool` declares both of them as parents, so a tool run may sit
  directly under the run when no turn is open. The definition declares which
  name plays which role and the generic fold reads the declaration, so no
  pi-shaped branch is added to the pipeline.

  Out of scope: instrumenting the pi harness our own worker runs, which is
  product internals rather than a customer's coding agent, and the pi VS Code
  extension, which has not been captured. Keeping our own use of pi out of a
  customer's session list is in scope, and is the last Rule below.

Rule: Only pi's own namespace joins a pi session

  # pi's definition matches on the record name alone, `pi.` as a prefix, and
  # deliberately not through the shared helper every other agent uses. That
  # helper also substring-matches the instrumentation scope and the service
  # name, and "pi" is a substring of "copilot", of "anthropic" and of the plain
  # word "api", so a scope- or service-matching pi would claim their signals.

  # becomes @unit
  @unimplemented
  Scenario: A span in pi's namespace is admitted as a pi session span
    Given the run, turn and tool spans of one pi session
    When the session span gate decides on each
    Then each is admitted

  # becomes @unit
  @unimplemented
  Scenario: A copilot span is never claimed by pi
    Given a copilot span whose service name is "copilot-cli"
    When the agent behind it is detected
    Then it is detected as copilot
    And it is not detected as pi

  # becomes @unit
  @unimplemented
  Scenario: A span whose scope or service merely contains pi's two letters is not pi's
    Given a span whose service name is "anthropic"
    And a span whose instrumentation scope ends in "api"
    When the agent behind each is detected
    Then neither is detected as pi

  # becomes @unit
  @unimplemented
  Scenario: A pi span of an undeclared name is not admitted
    Given a span named "pi.internal.gossip"
    When the session span gate decides on it
    Then it is not admitted

  # The declared list is the run and the turn only, so four harness spans pi
  # declares are deliberately given up: compaction, step, checkpoint and
  # navigation. Nothing is lost today, since pi fires no extension event for
  # any of them. Compaction is the one to watch: it is already a canonical
  # event we fold for other agents.

  # becomes @unit
  @unimplemented
  Scenario: A harness span pi declares but we do not list is dropped with nothing recorded
    Given a span named "pi.harness.compaction" in an otherwise admitted pi session
    When the session span gate decides on it
    Then it is not admitted
    And the session row records nothing for it

Rule: Our own in-house use of pi never becomes a customer session

  # Our worker embeds pi's extension API, so a `pi.*` span could one day leave
  # our own process. It is kept apart by a registry record of its own listed
  # BEFORE pi's, the shape the registry already uses for Claude Cowork ahead of
  # Claude Code, rather than by narrowing pi's predicate. Order decides because
  # detection is first match wins.

  # becomes @unit
  @unimplemented
  Scenario: A pi span carrying our worker's own marker is attributed to our worker, not to pi
    Given a pi.harness.run span carrying the marker that identifies our own worker
    And our worker's record is registered ahead of pi's
    When the agent behind it is detected
    Then it is detected as our own worker
    And no pi session row is folded for it

  # becomes @unit
  @unimplemented
  Scenario: A customer pi span is still pi once our worker has a record of its own
    Given our worker's record is registered ahead of pi's
    And a pi.harness.run span carrying no such marker
    When the agent behind it is detected
    Then it is detected as pi

Rule: One row per pi session, keyed by pi's own session id

  # becomes @unit
  @unimplemented
  Scenario: A pi session becomes one row keyed by pi's session id
    Given the spans of one pi session whose run carries pi.session.id
    When they are folded
    Then exactly one session row exists, keyed by that session id
    And the row shows the model and the input and output tokens

  # becomes @unit
  @unimplemented
  Scenario: Two concurrent pi sessions fold into two rows
    Given the spans of two pi sessions interleaved in arrival order
    When they are folded
    Then two session rows exist, one per session id

  # becomes @unit
  @unimplemented
  Scenario: Tokens are counted from the model calls, never again from the run
    Given a pi run whose usage is the rollup of its two model calls
    When the session is folded
    Then the row's tokens equal the sum of the two model calls

  # becomes @unit
  @unimplemented
  Scenario: Tool runs are counted under pi's own tool names
    Given a pi session that executed "read" twice and "bash" once
    When the session is folded
    Then the row's tool counts are "read" twice and "bash" once
    And its tool call total is three

  # becomes @unit
  @unimplemented
  Scenario: The run sets the row's start, whatever the arrival order
    Given a pi session whose run span arrives after its turns
    When the session is folded
    Then the row starts when the run started

  # becomes @unit
  @unimplemented
  Scenario: A pi span with no resolvable session mints no row
    Given a pi.harness.turn span carrying no session id and no admitted run
    When it is folded
    Then no session row is created for it

  # becomes @unit
  @unimplemented
  Scenario: A session the user aborted is not recorded as a failure
    Given a pi run whose pi.operation.outcome is pi's "aborted" value
    When the session is folded
    Then the row's stop reason is that same "aborted" value
    And the row counts no internal errors and no API errors

Rule: pi sessions reach the trace explorer as pi, not as an unknown agent

  # becomes @unit
  @unimplemented
  Scenario: A pi trace is detected as pi by the terminal banner
    Given a trace whose spans are in pi's namespace
    When the banner agent is detected
    Then it is pi
    And pi's own name and icon are shown, not the unknown-agent fallback

  # becomes @unit
  @unimplemented
  Scenario: pi spans are recognised as coding-agent origin, not a generic AI tool
    Given spans ingested under sourceType "pi_cli"
    When their origin is resolved
    Then the origin is the coding-agent origin

Rule: The context joins the spans only when the session id is the same string

  # becomes @unit
  @unimplemented
  Scenario: A context record and spans sharing one session id fold into one row with its branch
    Given a session-context record for session "s-1" naming a repository and head branch
    And pi.harness.run spans carrying pi.session.id "s-1"
    When they are folded
    Then the "s-1" row carries that repository and branch

  # becomes @unit
  @unimplemented
  Scenario: A context record under a different session id leaves the span session without a branch
    Given a session-context record for session "s-1" naming a repository and head branch
    And pi.harness.run spans carrying pi.session.id "s-2"
    When they are folded
    Then the "s-2" row carries no repository and no branch

Rule: pi sessions feed pull requests on exactly the state the mapping reads

  # The mapping guard reads four fold-state fields and nothing else: the
  # repository host, owner and name, and the branch. Any one of them missing,
  # or a host no GitHub call can answer for, and the session is rejected before
  # a job is staged.

  # becomes @unit
  @unimplemented
  Scenario: A pi session whose context named a repository and branch links to its pull request
    Given a folded pi session whose session-context record named a repository and head branch
    And an open pull request on that branch
    When pull requests are mapped
    Then the session is linked to that pull request

  # becomes @unit
  @unimplemented
  Scenario: A pi session with no context record maps no pull requests
    Given a folded pi session whose spans arrived without any session-context record
    When pull requests are mapped
    Then the session is linked to no pull request

  # becomes @unit
  @unimplemented
  Scenario: A pi session on a repository host the mapping cannot answer for is rejected
    Given a folded pi session whose context named a repository on a host outside GitHub
    When pull requests are mapped
    Then no mapping job is staged for it
    And the session is linked to no pull request

  # becomes @unit
  @unimplemented
  Scenario: A pi session with a repository but no branch is rejected
    Given a folded pi session whose context named a repository host, owner and name
    And the session carries no branch
    When pull requests are mapped
    Then no mapping job is staged for it
    And the session is linked to no pull request

Rule: A pi session bills against a real source

  # The billable lookup is keyed on the AI-tool catalogue slug, not on the
  # ingest key's source type, which is why copilot resolves to "github_copilot"
  # rather than to "copilot_cli". pi needs no arm there: the fallthrough returns
  # the agent id unchanged, so pi already resolves to "pi". An arm mapping it to
  # "pi_cli" would break the lookup it was meant to fix.

  # becomes @unit
  @unimplemented
  Scenario: A pi session's billable lookup resolves through the catalogue slug, not the key's source type
    Given a folded pi session whose spans arrived under sourceType "pi_cli"
    When its usage is prepared for billing
    Then the source the billable decision is made against is "pi"
    And the decision is made against that source, not a missing one
