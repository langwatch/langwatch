Feature: Scenario child execution contract stays private to the child

  `packages/features/scenario/contract/src/scenario-execution-data.ts` defines
  the validated stdin contract between the worker and its isolated child.
  Portable field mappings live separately in `field-mapping.ts`, so Suite and
  browser authoring do not import the child execution payload.

  # ---------------------------------------------------------------------------
  # The boundary
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Nothing outside the child's own tree imports the execution contract
    Given the application source tree
    When every import of the scenario execution contract is collected
    Then all of them come from files inside the scenario execution tree

  @unit
  Scenario: The shared field mapping schema carries no framework dependency
    Given the shared field mapping module
    When its imports are inspected
    Then it imports zod and nothing else

  # ---------------------------------------------------------------------------
  # Both sides still agree on the shape
  # ---------------------------------------------------------------------------

  # A split that let the two definitions drift would be worse than the coupling
  # it removed: a suite would save a mapping the child then refused to parse.

  @unit
  Scenario: A mapping accepted by the suite target schema is accepted by the child
    Given a suite target carrying a source mapping and a literal mapping
    When the child's job data schema parses the same mappings
    Then both schemas accept them

  # ---------------------------------------------------------------------------
  # The fence the child dials a target through
  # ---------------------------------------------------------------------------

  # A child inherits an allowlisted handful of the operator's environment and
  # runs under SKIP_ENV_VALIDATION, so a fence it resolved for itself would be
  # the library default rather than the deployment's: an install that blocks
  # local addresses everywhere else would stop blocking them the moment the
  # call moved into a child.

  @unit
  Scenario: The child is handed the deployment's own egress policy
    Given a deployment that blocks local addresses and allowlists one host
    When the parent builds a child's environment
    Then the child is handed that exact policy

  @unit
  Scenario: A child handed no egress policy refuses rather than assuming one
    Given a child process started without a stated egress policy
    When it reads the policy an HTTP target would be dialled through
    Then it fails by naming the variable instead of defaulting the fence open
