Feature: A directory token reaches only its own connection's groups
  As an enterprise running two identity providers against one LangWatch
  organization
  I need each directory's pushes and reads to stay inside the connection its
  token was issued for
  So that one directory can never rename, empty or even see the groups
  another directory owns

  # WHY THIS EXISTS. A group used to be identified by its name inside an
  # organization. Two connections at the same organization - a migration
  # running both providers side by side is the ordinary case - then pushed
  # "Engineering" at the same row, and whichever directory synced last won.
  # A rename on one side deleted and recreated the other side's group, which
  # took its members' access with it.
  #
  # THE RULE. A group records the connection that pushed it, and identity is
  # the pair (connection, externalId) rather than the name. Everything else
  # here follows from that pair: a rename is the same group because the
  # identifier did not change, and two connections may both hold a group
  # called "Engineering" because the pairs differ.
  #
  # TWO REFUSALS, DELIBERATELY DIFFERENT. A READ of a sibling's group answers
  # 404, because a token that may not see a group may not learn it exists.
  # A WRITE answers a refusal about authority, because the caller already
  # named a group it does not own and telling it "no such group" would send
  # an administrator hunting for a sync that is working correctly.
  #
  # GRANDFATHERING. Groups that predate connection scoping carry no
  # connection, and tokens minted before it carry none either. Neither may be
  # cut off: an unscoped group stays visible to every token in its
  # organization, and an unscoped token keeps the organization-wide reach it
  # was issued with.

  Background:
    Given an organization "acme" with two single sign-on connections, "okta" and "entra"
    And a directory token issued for "okta"

  Rule: a group belongs to the connection that pushed it

    @unit
    Scenario: A group records the connection that pushed it
      When the "okta" directory pushes a new group
      Then the group it creates carries the connection "okta"

    @unit
    Scenario: A group echoes the identifier its directory sent
      When the "okta" directory pushes a group with the external identifier "okta-grp-1"
      Then the group it creates answers with that same identifier

    @unit
    Scenario: A group renamed in the directory stays one group
      Given "okta" has already pushed a group with the external identifier "okta-grp-1"
      When the same directory pushes that identifier again under a new name
      Then no second group is created
      And the push is refused as a duplicate rather than doubling the group

    @unit
    Scenario: Two connections each carry their own group of the same name
      Given "okta" has already pushed a group called "Engineering"
      When the "entra" directory pushes its own group called "Engineering"
      Then both groups exist, each carrying its own connection

  Rule: a read may not learn that another connection's group exists

    @unit
    Scenario: A read hides a sibling connection's group
      Given "entra" has pushed a group
      When the "okta" token reads that group
      Then it is answered not found rather than with the sibling's group

    @unit
    Scenario: A group that predates connection scoping stays visible
      Given a group in "acme" that names no connection
      When the "okta" token reads that group
      Then it is answered with the group

    @unit
    Scenario: A legacy token keeps organization-wide reach
      Given a directory token issued before connections were scoped
      When it reads any group in "acme"
      Then it is answered with the group

  Rule: a write to a group the token does not own is refused by authority

    @unit
    Scenario: A write to a sibling connection's group is refused by authority
      Given "entra" has pushed a group
      When the "okta" token deletes or renames that group
      Then it is refused for writing outside its own connection
      And nothing about the group changes

  Rule: a push may only name people its own directory asserted

    @unit
    Scenario: A connection may only name people its own directory asserted
      When the "okta" directory pushes a group naming two members
      Then every named member is checked against "okta"'s own identity mapping
      And a legacy token that names no connection is asked nothing
