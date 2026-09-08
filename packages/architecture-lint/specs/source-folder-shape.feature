Feature: A folder is one concept and a file is one readable part
  As a maintainer
  I want a source tree that reads as concepts, not as a filing cabinet
  So that a reader, human or agent, finds the file that owns a noun without a search

  Background:
    Given architecture lint scans every source folder under apps and packages
    And the messages it emits are written as the instruction the author should have followed

  @unit @architecture
  Scenario: A crowded folder is refused with the instruction to fold or split
    Given a source folder holds more files than the folder budget
    When architecture lint checks the workspace
    Then it reports the folder with its file count
    And the message tells the author to put the code in the file that already owns its noun
    And the remedy says to split the folder, not the file, when no file owns it

  @unit @architecture
  Scenario: A fragment of a neighbouring file is refused with the instruction to fold it in
    Given a source file below the fragment floor is imported only by files in its own folder
    When architecture lint checks the workspace
    Then it reports the file as a paragraph of the file that reads it
    And the remedy says to move the code into that file and delete the fragment

  @unit @architecture
  Scenario: A baselined finding is silent and a stale baseline entry is reported
    Given the source folder shape baseline lists a folder or file
    When the finding still holds
    Then no violation is reported for it
    When the finding no longer holds
    Then the baseline entry is reported as one that must be removed
