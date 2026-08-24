Feature: AI Gateway control-plane target cannot silently default to the wrong worktree
  As a developer running several LangWatch worktrees at once
  I want the AI Gateway to always know which control plane is actually mine
  So that spend, budget and auth traffic can never silently apply to a different worktree

  # The gateway (services/aigateway) ships spend-emitter batches, budget
  # checks and auth resolution to a "control plane" URL. Getting that URL
  # wrong is invisible at the gateway's own hot path: LLM traffic keeps
  # proxying fine and every request still returns 200, because the wrong
  # control plane answers just as happily as the right one. Only the
  # spend, budget and auth side effects land somewhere else, silently.
  #
  # `pnpm dev` (platform/app/scripts/start.sh) derives this URL from the
  # app's own PORT before it starts a gateway itself, so a freshly-started
  # gateway is always correct. That path is proven, existing behavior and
  # is not what this feature covers.
  #
  # Two gaps remained:
  #
  #   - A standalone `make service svc=aigateway` / `make service-watch
  #     svc=aigateway` derived nothing: an unset LW_GATEWAY_BASE_URL fell
  #     straight through to services/aigateway/config.go's compatibility
  #     default, which is only correct for a single worktree on the
  #     default port.
  #   - When `pnpm dev` finds its derived gateway port already listening,
  #     it reuses that process without ever asking where ITS spend, budget
  #     and auth traffic actually goes, so a stale or foreign gateway
  #     sitting on that port gets trusted blind.
  #
  # Closing them: `make service` / `make service-watch` now derive the
  # control-plane URL the same way start.sh does
  # (dev/scripts/lib/derive-gateway-base-url.sh), the gateway tracks and
  # logs whether its control-plane URL was explicitly configured or fell
  # back to the compatibility default, and it exposes the resolved target
  # on an unauthenticated debug endpoint so dev tooling can verify a
  # reused process before trusting it, warning loudly on any mismatch or
  # on a process too old to answer at all.

  # --- Standalone `make service` / `make service-watch` ---

  @unit
  Scenario: make service derives the control-plane URL from PORT when it is unset
    Given a worktree whose app runs on a non-default PORT
    And LW_GATEWAY_BASE_URL is not set anywhere
    When "make service svc=aigateway" resolves its environment
    Then it derives LW_GATEWAY_BASE_URL from that PORT, matching the API port pnpm dev would use
    And it prints what it derived

  @unit
  Scenario: make service leaves an explicit control-plane URL untouched
    Given LW_GATEWAY_BASE_URL is already set, whether inherited from the shell or from .env
    When "make service svc=aigateway" resolves its environment
    Then the explicit value is used unchanged

  @unit
  Scenario: make service falls back to the default port pairing when PORT is unset too
    Given neither PORT nor LW_GATEWAY_BASE_URL is set
    When "make service svc=aigateway" resolves its environment
    Then it derives the same control-plane URL as the single-worktree default case

  # --- The gateway's own awareness of how it was configured ---

  @unit
  Scenario: the gateway reports the control-plane URL as not explicitly configured when it was defaulted
    Given the gateway boots with no LW_GATEWAY_BASE_URL and no legacy control-plane URL variable set
    When it loads its configuration
    Then it reports the control-plane URL as not explicitly configured
    And a deployment that boots this way logs a warning naming the URL spend will actually ship to

  @unit
  Scenario: the gateway reports the control-plane URL as explicitly configured when LW_GATEWAY_BASE_URL is set
    Given the gateway boots with LW_GATEWAY_BASE_URL set
    When it loads its configuration
    Then it reports the control-plane URL as explicitly configured

  @unit
  Scenario: the gateway reports the control-plane URL as explicitly configured when the legacy control-plane URL variable is set
    Given the gateway boots with only the legacy control-plane URL variable set
    When it loads its configuration
    Then it reports the control-plane URL as explicitly configured

  # --- Verifying a reused gateway before trusting it ---

  @unit
  Scenario: the gateway exposes its resolved control-plane target on an unauthenticated debug endpoint
    Given a running gateway with a resolved control-plane URL
    When something requests its control-plane debug endpoint
    Then it reports that exact URL
    And the endpoint requires no credential, matching the k8s probes and the metrics endpoint

  @unit
  Scenario: a reused gateway pointed at the right control plane raises no warning
    Given pnpm dev finds a gateway already listening on the port it would have started its own on
    And that gateway's debug endpoint reports the same control-plane URL this worktree expects
    When pnpm dev evaluates whether to trust the reused gateway
    Then it raises no warning

  @unit
  Scenario: a reused gateway pointed at a different control plane raises a loud, actionable warning
    Given pnpm dev finds a gateway already listening on the port it would have started its own on
    And that gateway's debug endpoint reports a control-plane URL different from what this worktree expects
    When pnpm dev evaluates whether to trust the reused gateway
    Then it raises a multi-line warning naming both the expected and the actual control-plane URL
    And the warning states how to fix it

  @unit
  Scenario: a reused gateway whose control-plane target cannot be verified is treated as suspect, not silently trusted
    Given pnpm dev finds a gateway already listening on the port it would have started its own on
    And that gateway's debug endpoint cannot be reached, for instance because it predates this check
    When pnpm dev evaluates whether to trust the reused gateway
    Then it raises a warning saying the control-plane target could not be verified
    And it does not claim the reused gateway is safe
