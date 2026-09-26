Feature: A module mounts the host its screens read
  A screen reads its module's *HostApi and never the router or a capability
  directly. If nothing mounts that host, the screen throws when a customer
  navigates to it — 31 modules were in exactly that state, each waiting for a
  visitor. The record refuses the old answer, which was a host implementation
  per module inside apps/ui.

  So the mount travels the way a screen and a drawer already do: the module
  declares a loader, and the composition root collects every declared mount and
  renders them as one stack around the routed tree. Around the tree, not around
  the declaring module's own screens — a host is regularly read by a PEER's
  screens, and a host that reads the address bar has to be inside the router.

  Background:
    Given a browser application composed from the installed module list

  @unit
  Scenario: Every declared mount is collected, named by its module and host
    Given two installed modules that each mount a host
    When the composition root collects the installed host mounts
    Then both are returned in install order, each named by module and host
    And each carries the loader its declaration named

  @integration
  Scenario: A module's host is mounted above the page that reads it
    Given an installed module that mounts a host and a screen that reads it
    When a customer opens that screen
    Then the screen reads the host rather than throwing

  @integration
  Scenario: A module's host is mounted above a peer's page too
    Given a module that mounts a host and a peer module whose screen reads it
    When a customer opens the peer's screen
    Then the peer's screen reads the same host
    # This is what per-screen wrapping cannot do, and why the stack sits at the
    # router root rather than around the declaring module's own loaders.

  @integration
  Scenario: A module's host is mounted above an open drawer too
    Given a module that mounts a host and a drawer that reads it
    When the address bar opens that drawer
    Then the drawer reads the host rather than throwing
    # Drawers render beside the routed page, so a stack around the page alone
    # left every scenario drawer throwing on its missing ScenarioHostProvider.

  @integration
  Scenario: A mounted host answers the reading its screen renders from
    Given a module whose host mount resolves its organization from its own read
    When a customer opens the screen that renders from that organization
    Then the screen renders the organization rather than nothing
    # Mounting is necessary and not sufficient. Project's mount was installed
    # and answered organization() and project() with a hardcoded undefined, so
    # Settings > General hit its own `if (!organization) return null` on every
    # load: a framed, empty pane, no console error and no failed request.

  @unit
  Scenario: A mount with nothing to render is refused by name
    Given an installed module whose host mount resolves to no component
    When the composition root renders the application
    Then it refuses, naming the module and the host

  # Both halves of the seam are free strings, so a module requiring
  # "WorkflowHostApi" while mounting "WorkflowHost" satisfies the unmounted
  # check and still crashes at render. Reading the seam from the mount side is
  # what names the typo, and it is why a module declares both halves at once.
  @unit
  Scenario: A host mounted under a name nothing reads is refused
    Given an installed module that mounts a host no module declares it reads
    When the composition root checks the installed mounts
    Then it refuses, naming the module and the host it mounted
