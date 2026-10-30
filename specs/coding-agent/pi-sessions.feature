Feature: pi sessions
  pi sessions and the pull requests they feed. Decision:
  dev/docs/adr/188-pi-as-a-natively-instrumented-coding-agent.md.

  pi names its spans in its own namespace, declared in
  `@earendil-works/pi-agent-core`: `pi.harness.run` is the session root and
  carries `pi.session.id`, `pi.harness.turn` sits under the run, and
  `pi.harness.tool` sits under the turn. The definition declares which name
  plays which role and the generic fold reads the declaration, so no pi-shaped
  branch is added to the pipeline.

  pi's spans reach us through the extension the wrapper installs, see
  specs/ai-governance/cli-wrappers/pi-extension-install.feature. Repository and
  branch arrive through the session context hook, see
  specs/ai-governance/cli-wrappers/session-context-hook.feature.

  Out of scope: the pi harness Langy runs in its own worker, which is our
  product internals rather than a customer's coding agent, and the pi VS Code
  extension, which has not been captured.

  Rule: Only pi's own namespace joins a pi session

    @unit
    Scenario: A span in pi's namespace is admitted as a pi session span
      Given the run, turn and tool spans of one pi session
      When the session span gate decides on each
      Then each is admitted

    @unit
    Scenario: Another agent's span is never claimed as pi's
      Given a span whose service name is "anthropic"
      And a span from the copilot scope
      And a span whose scope mentions "openai"
      When the session span gate decides on each
      Then none is admitted as pi's

    @unit
    Scenario: A pi span of an undeclared name is not admitted
      Given a span named "pi.internal.gossip"
      When the session span gate decides on it
      Then it is not admitted

    @unit
    Scenario: A pi span with no resolvable session is dropped, never keyed on its trace id
      Given a pi.harness.turn span carrying no session id and no admitted run
      When the span facts are lifted
      Then nothing is contributed

  Rule: One row per pi session, keyed by pi's own session id

    @unit
    Scenario: A pi session becomes one row keyed by pi's session id
      Given the spans of one pi session whose run carries pi.session.id
      When they are folded
      Then exactly one session row exists, keyed by that session id
      And the row shows the model and the input and output tokens

    @unit
    Scenario: Two concurrent pi sessions fold into two rows
      Given the spans of two pi sessions interleaved in arrival order
      When they are folded
      Then two session rows exist, one per session id

    @unit
    Scenario: Tokens are counted from the model calls, never again from the run
      Given a pi run whose usage is the rollup of its two model calls
      When the session is folded
      Then the row's tokens equal the sum of the two model calls

    @unit
    Scenario: Tool runs are counted under pi's own tool names
      Given a pi session that executed "read" twice and "bash" once
      When the session is folded
      Then the row counts two "read" runs and one "bash" run

    @unit
    Scenario: The row starts when the run started, whatever the arrival order
      Given a pi session whose run span arrives after its turns
      When the session is folded
      Then the row's start is the run's start

    @unit
    Scenario: A session the user aborted is not recorded as a failure
      Given a pi run whose operation outcome is pi's "aborted" value
      When the session is folded
      Then the row's outcome distinguishes an abort from a failure

  Rule: pi sessions reach the trace explorer as pi, not as an unknown agent

    @unit
    Scenario: A pi trace is detected as pi by the terminal banner
      Given a trace whose spans are in pi's namespace
      When the banner agent is detected
      Then it is pi
      And pi's own name and icon are shown, not the unknown-agent fallback

    @unit
    Scenario: pi spans are recognised as coding-agent origin, not a generic AI tool
      Given spans ingested under sourceType "pi_cli"
      When their origin is resolved
      Then the origin is the coding-agent origin

  Rule: pi sessions feed pull requests and bill against a real source

    @unit
    Scenario: A pi session with git context links to its pull request
      Given a folded pi session carrying repository and branch
      And an open pull request on that branch
      When pull requests are mapped
      Then the session is linked to that pull request

    @unit
    Scenario: A pi session's billable lookup resolves through its ingestion source type
      Given a folded pi session
      When its usage is prepared for billing
      Then the ingestion source type is "pi_cli"
      And the billable decision is made against that source, not a missing one
