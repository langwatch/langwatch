Feature: Deleted spellings stay deleted
  As an agent learning the architecture from the docs and the code
  I want ARCHITECTURE.md §15's deleted spellings refused where they would teach or grow
  So that a removed shape cannot slip back in through a skill, a doc or a new line of code

  Rule: `deleted-spellings-in-teaching` refuses a deleted spelling a teaching surface would teach

    @unit @architecture
    Scenario: A teaching surface that names a deleted spelling is reported with its replacement
      Given a skill that teaches a spelling §15 deletes
      When the teaching guard reads it
      Then it reports the file, the line, the spelling and the replacement to write instead

    @unit @architecture
    Scenario: A deletion note naming a deleted spelling passes
      Given a sentence, a deleted section, a framed list, a table or a code fence that says the spelling is deleted
      When the teaching guard reads it
      Then nothing is reported for the note
      And a use in the sentence after the note is still reported

    @unit @architecture
    Scenario: Architecture decision records and plans are not teaching surfaces
      Given a deleted spelling in an ADR and in a plan
      When the teaching guard runs
      Then it reads neither

  Rule: `deleted-spellings-in-code` counts every use in code, and the shrink-only list refuses a rise

    @unit @architecture
    Scenario: Every use of a deleted spelling in code is reported with its replacement and record section
      Given code that uses deleted identifiers and a file with a deleted name
      When the code guard runs
      Then each use is reported by line and each deleted file kind by file, with the replacement and the record section

    @unit @architecture
    Scenario: Generated code and a deletion note in code are not counted
      Given a generated file and a comment noting a deletion
      When the code guard runs
      Then it counts neither

    @unit @architecture
    Scenario: A new use over the list is refused and a removal must lower it
      Given a spelling whose count in code rose above the shrink-only list
      When the ratchet compares the counts
      Then the rise is refused
      And a fall must be written back to the list

    @unit @architecture
    Scenario: The deleted-spellings policies refuse to run without the list
      Given the deleted-spellings list is missing
      When either policy runs
      Then it throws, naming the policy and the list

    @unit @architecture
    Scenario: The list holds every spelling of §15 in a shape the guards can read
      Given the deleted-spellings list
      When it is read
      Then it parses and every pattern compiles

    @unit @architecture
    Scenario: No deleted spelling's count in code rises above the shrink-only list
      Given today's tree
      When the code guard counts every spelling
      Then no count is above its listed one and none is below it
