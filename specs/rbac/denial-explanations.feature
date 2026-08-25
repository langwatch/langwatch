Feature: Denial explanations
  As a member who has just been refused something
  I want the refusal to tell me which of my roles fell short and which role
  would let me do it
  So that I can ask an admin for the right thing instead of guessing

  # Spec for ADR-092 section 6 ("One Access surface, with 'why?' built in"):
  # "Explainability is not a feature bolted on later. It is the engine's
  # decision object, rendered."
  #
  # The engine has rendered its walk since stage A (AuthzEngine.explain, and
  # AuthzService.explainDecision above it) and nothing read it. This feature
  # is the first reader: the tRPC denial path.
  #
  # The walk has TWO audiences and they get different things. An operator
  # gets the lines verbatim, on a log line - they name scope ids, group ids
  # and the bindings the chain filtered out. A customer gets role labels and
  # nothing else, and the sentence built from them is written in the client
  # presentation registry, never on the server. That split is the point of
  # several scenarios below.
  #
  # Bound by:
  #   platform/app/src/server/app-layer/authz/__tests__/denial-explanation.unit.test.ts
  #   platform/app/src/server/app-layer/authz/__tests__/trpc-middleware.unit.test.ts
  #   platform/app/src/features/errors/logic/__tests__/presentation.unit.test.ts
  #   platform/app/src/server/api/__tests__/trpc-error-formatter.unit.test.ts

  Background:
    Given an organization "acme" with a project "chatbot"
    And a member "dana" holding the viewer role on "chatbot"

  @unit
  Scenario: A denied member is told which of their roles fell short
    When dana is refused "traces:share" on "chatbot"
    Then the refusal carries the roles she already holds on that project
    And it carries the roles that would grant "traces:share" there
    And she reads that her Viewer role does not include it, and that Admin and
      Member do

  @unit
  Scenario: The explanation names roles, never the bindings behind them
    When dana is refused "traces:share" on "chatbot"
    Then the refusal names no scope id, group id or role id
    And the engine's own walk goes to the log, not to the client

  @unit
  Scenario: The denial still works when the explanation cannot be computed
    Given the authorization engine cannot answer why dana was refused
    When dana is refused "traces:share" on "chatbot"
    Then she is still refused, with the same stable code
    And she reads the generic copy asking an admin to grant her "traces:share"

  @unit
  Scenario: A lite member's denial keeps its own messaging
    Given a lite member "sarah" in organization "acme"
    When sarah is refused "team:manage"
    Then her refusal carries the lite-member restriction, not an explanation
    And nothing offers her a role she cannot be given

  @unit
  Scenario: A denial for a reason no grant would fix carries no explanation
    Given dana's membership of "acme" has been disabled
    When dana is refused "traces:share" on "chatbot"
    Then the refusal says her access was disabled
    And it names no role to ask for

  @unit
  Scenario: The explanation survives the tRPC boundary as data
    When a denial carrying an explanation is serialised for the wire
    Then the client reads the same two role lists back out of it
    And the free-text message is still replaced by the stable code
