# Decision:
#   dev/docs/adr/148-declared-browser-supply.md
# Sibling contract:
#   specs/server/typed-process-supply.feature

Feature: A browser cannot boot without what its web modules declared

  Composing the browser is answering the same question the server answers, with
  different truths: what do the web modules I am installing need, and have I
  supplied it? There is no process, no store and no secret. There is a document
  that carries the deployment's configuration, a React tree, and routes that
  arrive lazily.

  The supply is a fluent chain ending in `render()`, which takes no arguments.
  Which calls are required is computed from what was installed. What a module
  contributes is declared, never installed by hand.

  Some of this is answerable by the compiler and some is not, and the split is
  the point: a module list is static, a document's contents are not. A refusal
  the browser only discovers at runtime still names itself in words a customer
  can read.

  Scenarios still carrying `@unimplemented` are tracked promises for later lanes.
  A lane drops that tag on the scenarios it binds, in the same change that binds them.

  Background:
    Given web modules that each declare their screens, drawers, commands, flags and config

  # ---------------------------------------------------------------------------
  # Only what was declared, and all of it
  # ---------------------------------------------------------------------------

  Rule: the supply required is exactly what the installed web modules declared

    @unit @unimplemented
    Scenario: A browser installing one module is asked only for that module's needs
      Given a single installed web module that declares one screen and no configuration
      When the composition supplies a document and a transport
      Then the browser renders
      And it is never asked for a session source or a configuration slice

    @unit @unimplemented
    Scenario: Supplying nothing names everything missing at once
      Given installed web modules that between them need configuration, a transport and a session
      When the composition supplies none of it
      Then the refusal names all three
      And it does not stop at the first

    @unit @unimplemented
    Scenario: Installing a module with its own settings makes a configuration reader required
      Given a browser composition that needed no configuration
      When a module carrying its own web settings is installed
      Then the composition is asked for a reader of the injected configuration

    @unit @unimplemented
    Scenario: A module declaring no drawers contributes none
      Given an installed web module that declares screens and no drawers
      When the drawer registry is composed
      Then it carries nothing from that module
      And opening an undeclared drawer name is refused by name

  # ---------------------------------------------------------------------------
  # Both halves, or neither
  # ---------------------------------------------------------------------------

  Rule: a module that ships both halves is installed into both, or into neither

    @unit @unimplemented
    Scenario: A module whose web half exists and is not installed fails the build
      Given a module carrying a server half and a web half
      When only its server half appears in the installed lists
      Then the build fails, naming the module and the half that is missing

    @unit @unimplemented
    Scenario: A module with only one half on disk installs into one place
      Given a module carrying a web half and no server half
      When the installed lists are generated
      Then the build passes
      And the module appears only in the browser's list

  # ---------------------------------------------------------------------------
  # Where a page sits
  # ---------------------------------------------------------------------------

  Rule: a screen declares its placement instead of having it read back off its address

    @unit @unimplemented
    Scenario: A screen names the product it belongs to
      Given a screen declared within a product
      When the shell resolves the page
      Then it draws that product's chrome
      And no prefix list is consulted to decide it

    @unit @unimplemented
    Scenario: A settings screen names its settings group
      Given a screen declared within a settings group
      When the shell resolves the page
      Then it draws the settings chrome rather than a product's
      And the settings menu lists the page under that group

    @unit @unimplemented
    Scenario: A screen placed nowhere that exists fails the build
      Given a screen declared within a product that no module declares
      Then the build fails, naming the screen and the placement it asked for

    @unit @unimplemented
    Scenario: A page with no label earns no menu entry
      Given a screen declared with a path and no label
      When the menus are composed
      Then the page is reachable at its address
      And no menu lists it

    @integration @unimplemented
    Scenario: Two modules claiming one address are refused by name
      Given two installed web modules whose screens declare the same path
      When the browser boots
      Then it refuses before the first render, naming both modules and the address

  # ---------------------------------------------------------------------------
  # Drawers and commands
  # ---------------------------------------------------------------------------

  Rule: a drawer is opened by a name and with props the drawer declared

    @unit @unimplemented
    Scenario: Opening a drawer with props it does not take fails the build
      Given a drawer declared with its own props
      When a caller opens it with a property the drawer does not declare
      Then the build fails, naming the drawer and the property

    @unit @unimplemented
    Scenario: Two modules declaring one drawer name fail the build
      Given two installed web modules declaring the same drawer name
      Then the build fails, naming both modules and the drawer
      And the two declarations are not silently combined

    @integration @unimplemented
    Scenario: Every declared drawer opens from its own address
      Given the composed drawer registry
      When each drawer name is put in the address bar
      Then each one mounts

  Rule: a command may only open something its own module declared

    @unit @unimplemented
    Scenario: A command opening an undeclared screen fails the build
      Given a command declared to open a screen key its module does not declare
      Then the build fails, naming the command and the key

    @unit @unimplemented
    Scenario: A command opening an undeclared drawer fails the build
      Given a command declared to open a drawer name its module does not declare
      Then the build fails, naming the command and the drawer

    @unit @unimplemented
    Scenario: A navigation command follows its screen when the address moves
      Given a command that opens a declared screen
      When that screen's path changes
      Then the command opens the new address without being edited

  # ---------------------------------------------------------------------------
  # Feature flags
  # ---------------------------------------------------------------------------

  Rule: a module reads only the flags it declared

    @unit @unimplemented
    Scenario: Reading an undeclared flag fails the build
      Given a module that declared one browser-visible flag
      When it reads a different one
      Then the build fails, naming the module and the flag

    @unit @unimplemented
    Scenario: Declaring a flag that does not exist fails the build
      Given a module declaring a flag the browser-visible list does not carry
      Then the build fails, naming the flag

    @unit @unimplemented
    Scenario: A browser-visible flag no module declares is reported
      Given the declared flags of every installed module
      When they are compared with the browser-visible list
      Then a flag no module declares is named

  # ---------------------------------------------------------------------------
  # Configuration, which arrives in the document
  # ---------------------------------------------------------------------------

  Rule: every installed module's configuration slice has a source, and the compiler says so

    @unit @unimplemented
    Scenario: A module whose settings have no projection fails the build
      Given a module declaring web settings
      When it declares no projection from the injected configuration
      Then the build fails, naming the module

    @unit @unimplemented
    Scenario: A projection naming a field the injected configuration does not carry fails the build
      Given a module projecting a field the public configuration does not declare
      Then the build fails, naming the module and the field

  Rule: what the document actually carries is checked at boot, before the first render

    @integration @unimplemented
    Scenario: The document carries no configuration
      Given a document with no injected configuration
      When the browser boots
      Then it refuses before the first render
      And the reader is shown named copy, not a blank page

    @integration @unimplemented
    Scenario: A module refuses the value it was given
      Given an injected configuration whose slice fails a module's own schema
      When the browser boots
      Then it refuses before the first render, naming the module
      And the refusal never repeats the value it refused

    @integration @unimplemented
    Scenario: A configuration that parses draws no screen before it is checked
      Given an injected configuration every installed module accepts
      When the browser boots
      Then every slice is parsed before the first render

    @unit @unimplemented
    Scenario: A key no module claims is still refused
      Given an injected configuration carrying a key the schema does not declare
      When it is read
      Then it is refused, because one image writes and reads it

  # ---------------------------------------------------------------------------
  # The browser holds no environment and no secret
  # ---------------------------------------------------------------------------

  Rule: nothing in the browser reads the environment

    @unit @unimplemented
    Scenario: The development reading comes from the injected configuration
      Given a deployment whose injected configuration names its mode
      When a screen asks which build it is running in
      Then the answer comes from that configuration
      And no browser source reads the bundler or process environment

    @unit @unimplemented
    Scenario: The chain supplies nothing a browser may not show
      Given the browser composition chain
      Then it has no call that takes a secret or an encryption key

  # ---------------------------------------------------------------------------
  # The chain itself
  # ---------------------------------------------------------------------------

  Rule: the browser renders only when nothing is outstanding

    @unit @unimplemented
    Scenario: Rendering with a supply outstanding fails the build
      Given installed modules that require a transport
      When the composition calls render without supplying one
      Then the build fails, naming the transport

    @unit @unimplemented
    Scenario: A test composition differs from the browser's by one call
      Given the browser composition and its test harness
      Then they differ only in which document and which configuration reader they supply

    @integration @unimplemented
    Scenario: A page whose module is not installed is not an address
      Given a page key declared by a module this build does not install
      When a reader opens its address
      Then the application answers with its not-found page
      And the boot does not refuse
