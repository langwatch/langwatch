Feature: Admins can tell a full seat from a lite seat before they buy one

  Seats are the one thing a paid plan still meters, so "does this person need a
  full seat?" is a billing question an admin has to answer for every hire. The
  answer is about capability: someone who can only look at what the team
  produces holds a lite seat, someone who can change things holds a full one.

  The product asked the question the other way around, offering "Lite Member"
  as a label with a one-line description of two of its effects, which left
  admins guessing at the boundary and asking their account manager instead.

  Background:
    Given I am an admin adding people to my organization

  Rule: the difference is explained where the choice is made

    @integration
    Scenario: The invite form explains what a lite member can do
      When I open the add-members form
      Then the lite member option says they can view but not change
      And I can open a fuller explanation without leaving the form
      And that explanation lists what a lite member can see
      And it says they cannot see costs

    @integration
    Scenario: The role picker explains the same thing as the invite form
      When I change an existing member's organization role
      Then the lite member option carries the same explanation as the invite form

  Rule: the explanation matches how seats are actually counted

    @unit
    Scenario: The explanation names capability rather than a billing switch
      Given the copy shown to an admin choosing a seat type
      Then it describes a lite member by what they can do
      And it does not describe the choice as a billing setting
