Feature: What a directory listing and a directory patch answer
  As an identity provider synchronising people and groups into LangWatch
  I need a filter I send to be either honoured exactly or refused by name,
  and a patch that mentions one half of something to leave the other half
  alone
  So that a sync never silently reads a wider set than it asked for, and
  never erases a value it never mentioned

  # WHY A FILTER IS REFUSED RATHER THAN IGNORED. SCIM's filter grammar is far
  # richer than equality, and a listing that quietly ignored the part it could
  # not evaluate answered a WIDER set than the provider asked for. A provider
  # reconciling against that answer deletes the difference. So an expression
  # this listing cannot evaluate is refused, naming the attribute - and never
  # the value, which is somebody's address.
  #
  # WHY A PATCH MERGES. A provider that renames one half of a name sends only
  # that half, sometimes nested, sometimes as a dotted path, sometimes both in
  # one operation. Reading only the nested spelling silently dropped the
  # rename; overwriting the whole name erased the half nobody mentioned.

  Background:
    Given an organization "acme" whose directory is synchronised by a connection

  Rule: a filter is honoured exactly or refused by name

    @unit
    Scenario: A user listing filtered by userName matches without regard to case
      When a user listing is filtered by userName
      Then the term is matched without regard to case

    @unit
    Scenario: A user listing filtered by an unsupported attribute is refused
      When a user listing is filtered by an attribute it cannot match
      Then it is refused, naming the attribute
      And the refusal does not repeat the value it was given

    @unit
    Scenario: A group listing filtered by an unsupported expression is refused
      When a group listing is filtered by anything richer than equality
      Then it is refused rather than half-honoured

  Rule: an answer about people the connection cannot see is empty, never a failure

    @unit
    Scenario: An identifier the directory has never seen answers with nobody
      When a listing is filtered by an external identifier this connection never sent
      Then it answers an empty page with a total of nobody

    @unit
    Scenario: A page reports how many resources it actually carries
      Given a directory whose size is not a multiple of the page
      When the last, short page is read
      Then it reports the number of resources it actually carries
      And a full page reports the full count

  Rule: a patch changes what it mentions and nothing else

    @unit
    Scenario: A patch naming only the surname keeps the forename
      Given a person stored as "Ada Lovelace"
      When a patch names only the family name "Byron"
      Then the given name "Ada" is kept

    @unit
    Scenario: A patch sending the family name as a dotted path is applied
      When a patch sends the family name under the path "name.familyName"
      Then the half the path names is read and applied

    @unit
    Scenario: A group PATCH with case-insensitive add/remove operations changes only the membership delta
      Given a group with members
      When a patch sends "Add" and "Remove" operations in any casing
      Then only the members named by the operations are added and removed
