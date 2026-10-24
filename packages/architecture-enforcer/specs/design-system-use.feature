Feature: Browser code uses the design system and waits on events, not on time
  As a maintainer
  I want raw colours, rebuilt design-system components and timing workarounds in browser code reported
  So that the count of each only falls, and no change adds a new one without CI saying so

  See dev/docs/ARCHITECTURE.md §17 (Alex, 2026-10-20): rules 1, 6 and 15 are shrink-only lists.
  The policies read browser source: every module folder but contract and process (browser and
  client), in modules and enterprise/modules, and apps/ui/src and apps/sims/src. Tests, stories and
  fixtures are not read, and packages/design-system is never read.

  @unit @architecture
  Scenario: A Chakra colour variable in browser code is a raw colour
    Given a module browser file whose style value is "var(--chakra-colors-gray-500)"
    When the raw-colour policy reads browser source
    Then it reports the variable at its line

  @unit @architecture
  Scenario: A hex or rgb colour in a style value is a raw colour
    Given a module browser file with a hex colour in a colour prop, an rgba() in a css object and a hex in a CSS declaration string
    When the raw-colour policy reads browser source
    Then it reports each of the three

  @unit @architecture
  Scenario: A colour outside a style value is not a raw colour
    Given a module browser file with a hex in a comment, an issue reference "#1234" in copy and an rgb() built from variables
    When the raw-colour policy reads browser source
    Then it reports nothing

  @unit @architecture
  Scenario: Contract, process and test files are not read
    Given raw colours in a module's contract and process folders and in a browser test and story
    When the raw-colour policy reads browser source
    Then it reports nothing

  @unit @architecture
  Scenario: A Chakra factory button, input or anchor is a recomposition
    Given a module browser file rendering chakra.button, chakra.input and chakra("a") from the design system
    When the design-system-recomposition policy reads browser source
    Then it reports each one with its kind

  @unit @architecture
  Scenario: A Link sent to an in-app path is a recomposition
    Given a design-system Link with href "/settings", and one whose onClick cancels the click and navigates
    When the design-system-recomposition policy reads browser source
    Then it reports both as in-app links

  @unit @architecture
  Scenario: A Link that leaves the app is not a recomposition
    Given a design-system Link to "/docs" with target "_blank", one with isExternal, and one to an https address
    When the design-system-recomposition policy reads browser source
    Then it reports nothing

  @unit @architecture
  Scenario: A red Text printing a form field error is a recomposition
    Given a design-system Text with color "red.fg" whose child reads errors.name.message, and a red Text with plain copy
    When the design-system-recomposition policy reads browser source
    Then it reports only the one printing the form error

  @unit @architecture
  Scenario: A frame callback that reschedules itself until something appears is a timing workaround
    Given a function that queries for an element and calls requestAnimationFrame on itself while it is missing
    When the browser-timing-workaround policy reads browser source
    Then it reports the self-scheduling frame

  @unit @architecture
  Scenario: An animation loop is not a timing workaround
    Given a function that draws a frame and calls requestAnimationFrame on itself while the tween runs
    When the browser-timing-workaround policy reads browser source
    Then it reports nothing

  @unit @architecture
  Scenario: A frame that only defers to another frame or a zero timeout is a timing workaround
    Given a requestAnimationFrame whose callback only calls requestAnimationFrame, and one whose callback only calls setTimeout with 0
    When the browser-timing-workaround policy reads browser source
    Then it reports both as deferred frames

  @unit @architecture
  Scenario: A document query in module browser code is a timing workaround
    Given a module browser file calling document.querySelector for a rendered element
    And it reads a meta tag and guards an idempotent style injection with document.getElementById
    When the browser-timing-workaround policy reads browser source
    Then it reports only the query for the rendered element

  @unit @architecture
  Scenario: A timer re-reading a query with growing delays is a timing workaround
    Given a setTimeout that invalidates a query after a delay read from the list 500, 1000, 2000, 4000
    And a setTimeout that retries a fetch with a doubling delay but re-reads no query
    When the browser-timing-workaround policy reads browser source
    Then it reports only the growing re-read

  @unit @architecture
  Scenario: Every finding says what to write instead
    Given one finding of each kind of the three policies
    When the findings are read
    Then each names the design-system component, token or event to use instead and the shrink-only list it is counted in

  @unit @architecture
  Scenario: No browser file gains a raw colour
    Given the tree's raw colours counted per file
    When they are compared with tests/baselines/raw-colour.json
    Then no file is above its listed count

  @unit @architecture
  Scenario: A removed raw colour lowers the list in the same change
    Given the tree's raw colours counted per file
    When they are compared with tests/baselines/raw-colour.json
    Then every listed count is still reached

  @unit @architecture
  Scenario: No browser file gains a rebuilt design-system component
    Given the tree's recompositions counted per file and kind
    When they are compared with tests/baselines/design-system-recomposition.json
    Then no key is above its listed count

  @unit @architecture
  Scenario: A removed recomposition lowers the list in the same change
    Given the tree's recompositions counted per file and kind
    When they are compared with tests/baselines/design-system-recomposition.json
    Then every listed count is still reached

  @unit @architecture
  Scenario: No browser file gains a timing workaround
    Given the tree's timing workarounds counted per file and kind
    When they are compared with tests/baselines/browser-timing-workaround.json
    Then no key is above its listed count

  @unit @architecture
  Scenario: A removed timing workaround lowers the list in the same change
    Given the tree's timing workarounds counted per file and kind
    When they are compared with tests/baselines/browser-timing-workaround.json
    Then every listed count is still reached
