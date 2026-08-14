Feature: Scenario child execution contract stays private to the child

  `server/scenarios/execution/types.ts` describes the wire contract between the
  scenario worker and the child process it spawns: the job data written to the
  child's stdin, the adapter payloads inside it, and the execution context it
  runs under. It is meant to move to the child's own package, so that the app
  can stop depending on the scenario runner and the production image can stop
  shipping it.

  One thing stopped that move. `FieldMappingSchema` — how a single agent input
  is filled, from a scenario source or from a literal — lived in that same file,
  and two callers outside the child needed it: the suite target schema, and the
  optimization-studio DSL. The DSL is frontend-reachable, so the browser bundle
  reached into the child's execution contract to read one small schema.

  Splitting the schema into `server/scenarios/field-mapping.ts` gives each side
  what it actually needs: a zod-only module both can import, and an execution
  contract with no importers outside the child's own tree.

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
