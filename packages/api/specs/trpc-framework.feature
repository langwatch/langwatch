# See ../adrs/20260828-trpc-framework-boundary.md
Feature: tRPC framework boundary

  @typecheck @architecture
  Scenario: A root preserves concrete transport types
    Given a root declares a context and a procedure input
    When a router caller invokes that procedure
    Then its context, input and output remain concrete
    And the framework imports no application or feature module

  @typecheck @architecture
  Scenario: A procedure cannot be built without an authorization declaration
    Given a procedure has declared its input
    When no permission, opt-out or in-service authorization is declared
    Then the builder offers no query or mutation to call
    And the procedure does not compile

  @unit
  Scenario: A secret typed into a scalar field never reaches the audit trail
    Given a mutation whose action path carries its secret in a top-level field
    When its arguments are prepared for the audit trail
    Then that field's value is redacted
    And the field name is kept

  @unit
  Scenario: A slow call is raised without burying the log
    Given a call succeeds slower than its budget
    When it is recorded
    Then it is warned about at most once per interval per path
    And the next warning reports how many calls went unwarned

  @unit
  Scenario: A chain-defined procedure runs the process policy around its parsed input
    Given a procedure is defined through the fluent chain with an input, an output and an access declaration
    When a caller invokes it
    Then the input is parsed before the process policy runs
    And the policy is the one the process declared for that access decision

  @unit
  Scenario: An answer that its declared output schema refuses is raised where it is cheap to find
    Given a procedure declares the shape of its answer
    When the process asks for answers to be checked
    Then an answer the shape refuses is raised, naming the procedure and the field
    And an answer it accepts reaches the caller unchanged

  @unit @typecheck
  Scenario: A chain-built router is the same type the client already sees
    Given a router is built through the fluent chain
    When it is compared with the same router written by hand
    Then the two are the same type, not merely assignable

  @unit @typecheck
  Scenario: A stream declared through the chain is the same procedure the client subscribes to
    Given a subscription is defined through the fluent chain
    When it is compared with the same subscription written by hand
    Then the two are the same type
    And every value the stream yields is checked against its declared shape, not only the first

  @unit
  Scenario: A surface that is one procedure declares it on the same chain
    Given a feature's whole tRPC surface is a single procedure mounted at the root
    When it is declared on the chain
    Then what comes back is the procedure itself, not a router around it
    And it carries the same input, output and access declarations any procedure does

  @unit
  Scenario: A service mounts a child router without writing a record by hand
    Given a feature nests another router inside its own surface
    When the child is mounted on the chain by name
    Then the built router nests it exactly where hand-writing the record put it

  @unit
  Scenario: A surface whose every procedure carries its own policy declares none
    Given every procedure on a surface declares a custom permission
    When the surface is opened with no policy at all
    Then it builds, and a procedure that asks for a declared permission is refused by name


  # JSON only on the wire. The transformer that used to wrap it cost 31.5 ms to
  # encode a 428 KB payload against JSON's 1.1 ms, and the extra types it
  # preserved were not worth that on a read path.
  @unit
  Scenario: No transformer is configured on either side
    Given the process builds its tRPC root
    When the root's runtime configuration is read
    Then no data transformer is registered
    And the browser transport registers none either

  @unit
  Scenario: An instant crosses the wire as an ISO 8601 string
    Given a procedure answers with an instant
    When the response is encoded for the wire
    Then the instant is an ISO 8601 string
    And the client's type for that field says string

  @unit
  Scenario: A stored row's timestamp column arrives as a string
    Given a procedure answers with a stored row carrying a timestamp column
    When the client receives the answer
    Then that column holds an ISO 8601 string
    And a caller that needs an instant parses it at the point of use

  @unit
  Scenario: The live subscription lane carries plain JSON
    Given a subscriber opens a live procedure
    When an entry is written to the stream
    Then the frame is plain JSON
    And the subscription input was encoded as plain JSON too
