Feature: A literal or a copy has one owner
  As a maintainer
  I want a screen address, a source file, an ADR number and a contract's string spelled in one place
  So that the owner can change it without a second copy silently disagreeing

  See dev/docs/plans/platform-architecture-blocks.md rules 3, 4, 10 and 16 (Alex, 2026-10-20).
  Each rule is shrink-only (dev/docs/ARCHITECTURE.md §17): the policy reports every finding, and
  tests/baselines/<policy>.json holds today's count per key, which may fall and never rise.

  # peer-route-literal

  @unit @architecture
  Scenario: A literal spelling a peer module's screen address is reported
    Given module a's *.web.ts declares the screen path "/settings/widgets"
    And module b's browser source links to "/settings/widgets?tab=one"
    When the peer-route-literal policy reads the tree
    Then it reports b's literal against a's address

  @unit @architecture
  Scenario: A template literal filling a peer's address parameter is reported
    Given module a's *.web.ts declares the screen path "/:project/widgets"
    And an app builds the address `/${slug}/widgets/${id}`
    When the peer-route-literal policy reads the tree
    Then it reports the app's literal against a's address

  @unit @architecture
  Scenario: The owner's own literals and unrelated addresses are not reported
    Given module a's *.web.ts declares "/settings/widgets" and "/settings"
    And module a links to "/settings/widgets"
    And module b links to "/settings/other" and "/widgets/settings"
    When the peer-route-literal policy reads the tree
    Then it reports nothing

  @unit @architecture
  Scenario: A peer route finding names the owner and what to do instead
    Given module b spells module a's screen address
    When the peer-route-literal policy reports it
    Then the message names module a and tells the author to use a's exported href builder

  @unit @architecture
  Scenario: No new peer route literal lands
    Given the shrink-only list tests/baselines/peer-route-literal.json
    When the tree's peer route literals are counted per file and address
    Then no key holds more than its listed count, and no listed count is above what the tree holds

  # duplicate-across-modules

  @unit @architecture
  Scenario: A source file byte-identical to one in another module is reported
    Given modules a and b each hold the same 500-byte helper, one with CRLF line endings
    When the duplicate-across-modules policy reads the tree
    Then it reports both copies, each naming the other

  @unit @architecture
  Scenario: Copies inside one module, tests and small files are not reported
    Given two identical files inside module a, an identical test file in a and b, an identical 100-byte file in a and b
    When the duplicate-across-modules policy reads the tree
    Then it reports nothing

  @unit @architecture
  Scenario: A duplicate finding says to keep one copy and import it
    Given a file copied into a second module
    When the duplicate-across-modules policy reports it
    Then the message tells the author to keep one copy in the owning module's contract or package and import it

  @unit @architecture
  Scenario: No new cross-module copy lands
    Given the shrink-only list tests/baselines/duplicate-across-modules.json
    When the tree's cross-module copies are listed per file
    Then no copy is missing from the list, and every listed copy still exists

  # adr-number-unique

  @unit @architecture
  Scenario: Two ADRs sharing a number in one folder are reported
    Given dev/docs/adr holds 007-one.md and 007-two.md
    When the adr-number-unique policy reads the tree
    Then it reports both records under dev/docs/adr ADR-007

  @unit @architecture
  Scenario: The same number in two different ADR folders is not reported
    Given dev/docs/adr holds 001-one.md and modules/a/adrs holds 001-boundary.md
    When the adr-number-unique policy reads the tree
    Then it reports nothing

  @unit @architecture
  Scenario: An ADR number finding says to renumber the newer record
    Given two records share an ADR number
    When the adr-number-unique policy reports them
    Then the message tells the author to give the newer record the next free number

  @unit @architecture
  Scenario: No new ADR number collision lands
    Given the shrink-only list tests/baselines/adr-number-unique.json
    When the tree's ADR numbers are counted per folder
    Then no number holds more records than listed, and no listed count is above what the tree holds

  # restated-contract-constant

  @unit @architecture
  Scenario: A literal restating a contract's exported string constant is reported
    Given module a's contract exports WIDGET_KIND = "widget_srcdoc"
    And module b's process source and module a's browser source each spell "widget_srcdoc"
    When the restated-contract-constant policy reads the tree
    Then it reports both literals against WIDGET_KIND

  @unit @architecture
  Scenario: Short strings, shared vocabulary and the contract's own files are not reported
    Given module a's contract exports a short string, a date, a media type, a module id, a string a framework package spells and a string two contracts export
    And module a's contract repeats its own constant in a second file
    And module b spells every one of them
    When the restated-contract-constant policy reads the tree
    Then it reports nothing

  @unit @architecture
  Scenario: A restated constant finding says to import it from its contract
    Given a literal restating a contract constant
    When the restated-contract-constant policy reports it
    Then the message names the constant and tells the author to import it from its contract

  @unit @architecture
  Scenario: No new restated contract constant lands
    Given the shrink-only list tests/baselines/restated-contract-constant.json
    When the tree's restated contract constants are counted per file and string
    Then no key holds more than its listed count, and no listed count is above what the tree holds
