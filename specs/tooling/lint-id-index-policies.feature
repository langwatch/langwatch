Feature: The id-index lint policies
  A table looked up by id has an id index, declared once by its owning module
  with defineIdIndex. These policies keep each index paired with its
  declaration and every read by id bounded through the {{idBound}} marker.
  (dev/docs/plans/id-index-2026-10-10.md)

  Rule: `id-index-pairing` and `id-index-bounds` keep id indexes declared and reads bounded

    @unit
    Scenario: a read by id that skips its index is refused by the source check
      Given a module statement reading a declared index's source by its key
      When the statement carries no id-bound marker and no reason to skip one
      Then the architecture check reports it
  
    @unit
    Scenario: an id index and its declaration always come in pairs
      Given the goose migrations and the modules' id-index declarations
      When an index table has no declaration, or a declaration has no table or view
      Then the architecture check reports it
