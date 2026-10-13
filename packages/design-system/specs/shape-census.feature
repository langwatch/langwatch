Feature: The shape census measures how far screens are from the design system
  Each table, card, page, header, list page, pagination, drawer, dialog, empty state and tab
  is counted from the syntax tree of the browser sources, so a rollout can be cut by area.
  Roots, affected roots, parts and candidates are reported apart; scores only rank the work.

  @unit
  Scenario: A shape site is a clean design-system use, a restyled one or a hand-built look-alike
    Given a browser source that renders a design-system component or a layout primitive
    When the census reads it
    Then a design-system component with no style props counts as a clean site
    And style or layout props on the component or its parts count as a restyle, listing each prop
    And a primitive drawing the same shape by hand counts as a look-alike of that family

  @unit
  Scenario: Each distinct restyle of a family counts once as a variant
    Given several sites restyling the same design-system component
    When the census summarises them
    Then each distinct set of override props counts as one variant
    And the most common sets are listed with their count and example locations

  @unit
  Scenario: The target API counts as adopted roots, matched by exact source and export
    Given sources using the callable Drawer, Dialog and Card and LoadMore, CardGrid, ResourceTile, ListPage and ActionRow
    When the census reads them
    Then each is an adopted root with no violation
    And a semantic Card padding or variant is a choice, never a restyle
    And a style prop on a target shape is a violation
    And a target export imported from an unregistered source is unknown, never clean

  @unit
  Scenario: Legacy raw parts are violations even when they carry no style props
    Given sources using Drawer, Dialog, Card and EmptyState parts, RawDialog and RawPagination
    When the census reads them
    Then every part is a violation of its legacy rule
    And the parts of one drawer, dialog or pager share one owning root

  @unit
  Scenario: Namespace imports, aliases and destructuring resolve; shadowed names do not
    Given sources reaching a shape through a namespace import, a const alias or destructuring
    When the census reads them
    Then each is recognised as the same shape as a direct import
    And a local component or parameter that reuses a design-system name is not counted
    And a wrapper the census cannot see through is unknown, never clean

  @unit
  Scenario: Literal spreads and style conditions count as restyles, split by kind
    Given elements restyled through a literal spread, a const object spread or a condition object
    When the census reads them
    Then each style the spread or condition sets is listed as a restyle
    And cosmetic drift and geometry drift are counted apart
    And a spread the census cannot read is unknown

  @unit
  Scenario: A card box needs a real border and carries a destination
    Given layout primitives drawn with rounded corners
    When the census reads them
    Then a zero or none border draws no card
    And a literal border draws a candidate card box with its destination family
    And a border written as an expression is a heuristic candidate
    And a square card is a candidate while a small square is an icon tile

  @unit
  Scenario: Pagination finds append actions and scopes Previous and Next to one pager
    Given buttons labelled Load More, Show earlier, Previous and Next
    When the census reads them
    Then an append action with a real label is a violation
    And Previous and Next in one container are one hand pager
    And Previous and Next in unrelated parts of a file are not a pager

  @unit
  Scenario: A list page is inferred per component and labelled heuristic
    Given a component with a page header and a table and another that uses ListPage
    When the census reads them
    Then the header and table without ListPage is a heuristic candidate
    And a header in one component and a table in another is not inferred

  @unit
  Scenario: Headings carry a semantic level and an owning surface
    Given headings written as native h1, Heading, Text as h1 and raw header buttons
    When the census reads them
    Then a level one title outside the page header is a violation
    And a large Heading that is only styled as a title is a heuristic candidate
    And a raw Button in the page header or in ListPage actions is a violation

  @unit
  Scenario: Hand empty-state text is a candidate and EmptyState parts are legacy
    Given text reading like an empty state outside the empty-state components
    When the census reads it
    Then it is a heuristic candidate, not a violation
    And text written as an expression is read too

  @unit
  Scenario: Roots, affected roots, parts and candidates are reported separately
    Given a drawer with several violating parts and a part extracted into another component
    When the census summarises them
    Then the parts count once under their owning root
    And the extracted part is attributed to its own component
    And callers of a module's own copy are counted apart from roots
    And signatures are kept in full

  @unit
  Scenario: Upgrade files are counted but marked as owned elsewhere
    Given sources under an upgrades folder
    When the census reads them
    Then their sites carry the owner upgrade
    And the check lists them under owned elsewhere without failing the wave

  @unit
  Scenario: The check gate sorts sites into violations, approved escapes and candidates
    Given the sites of some paths and a list of approved escapes
    When the check evaluates them
    Then an unsuppressed violation fails the check with exit code 1
    And a violation matched by an escape is listed as approved and does not fail
    And an unclassified candidate or unknown fails with exit code 2
    And a candidate with a not-a-card destination is classified
    And an escape without a reason is refused

  @unit
  Scenario: The new tabs and table shapes count as adopted; raw parts are violations
    Given source using ContentTabs, CodeTabs, MetricTabs, TableToolbar, ColumnPicker, SelectionActionBar and ListTable parts
    Then each root counts as adopted and ListTable parts are adopted parts
    And raw Tabs and Table parts count as violations sharing their owning root

  @unit
  Scenario: Raw tabs and tables are found by what they import, not by how they are spelled
    Given sources using flat, aliased, namespace, native, polymorphic and factory spellings of tabs and tables
    When the census reads them
    Then TabsRoot, TableRow, an aliased part, native table tags, as="table", chakra.table and chakra("table") are violations
    And useTabs, even renamed on import, is a violation
    And a local component or variable with the same name is not

  @unit
  Scenario: An escape names one rule and may name one line
    Given an escape with a rule and a line and a violation of that rule on another line
    When the check evaluates them
    Then only the named line is approved
    And the registry holds no wildcard rule

  @unit
  Scenario: A gate that proves nothing refuses instead of passing
    Given a gate whose glob matches no source, or whose adopted roots fall below the minimum
    When the gate is judged
    Then it refuses with a reason
    And another owner's open rows are listed so a global gate can require them closed

  @unit
  Scenario: A padding row's height is its own prop, not a restyle
    Given a ListTable.PaddingRow with a height and an ordinary row with a height
    Then only the ordinary row reports a restyle
