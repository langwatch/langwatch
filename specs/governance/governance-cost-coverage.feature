@governance @cost
Feature: Every dollar has one home
  A connected provider bill and the gateway's own metering can describe the
  same spend. Which gateway keys a bill pays for is something an administrator
  says, never something we assume, and what they said last May has to keep
  being true when May is drawn again next year. So the answer is a dated
  record, the database itself refuses a second bill claiming a key somebody
  already claimed, and the screen's number is always the bill.
  Decision: ADR-128 sections 2 and 7.

  Rule: A key belongs to one bill at a time, and the database is what says so

    @integration
    Scenario: A second bill cannot claim a key another bill already covers
      Given a bill covering a gateway key from the first of the month
      When another bill is recorded as covering that same key from the same day
      Then the second record is refused
      And the administrator is told another bill already covers that key
      # Refused by the database, not by a read-then-write in the application:
      # two administrators saving at the same instant both pass the read.

    @integration
    Scenario: A bill may cover a key another bill has finished covering
      Given a bill that covered a gateway key until the first of June
      When another bill is recorded as covering that key from the first of June
      Then both records are kept
      And each month reads under the bill that covered it at the time

    @integration
    Scenario: Coverage that starts and ends at the same moment is refused
      When coverage is recorded that ends the instant it begins
      Then the record is refused
      # It describes no time at all, so nothing would ever notice it overlapping
      # anything, and the key would read as covered by a bill it never was.

    @integration
    Scenario: Coverage that ends before it begins is refused
      When coverage is recorded that ends before it begins
      Then the record is refused

    @integration
    Scenario: Coverage cannot name a different organization than its key
      Given a gateway key belonging to one organization
      When coverage for that key is recorded under another organization
      Then the record is refused
      # Nothing else would stop it: these are not real foreign keys.

  Rule: Re-pointing a key is one movement, so no day is left uncovered

    @integration
    Scenario: Moving a key to another bill closes the old coverage and opens the new together
      Given a bill covering a gateway key
      When an administrator moves that key to another bill from the first of next month
      Then the old coverage ends at that moment and the new coverage begins at it
      And no moment in between belongs to no bill

    @integration
    Scenario: A failed move leaves the original coverage intact
      Given a bill covering a gateway key
      When moving that key to another bill fails partway
      Then the key is still covered by the original bill

    @unit
    Scenario: Coverage may only start at midnight
      When an administrator records coverage starting partway through a day
      Then the record is refused
      And the administrator is told to pick a date
      # A day is the finest grain a bill can own, so a mid-day start would file
      # the whole day under whichever bill the reader happened to resolve.

    @unit
    Scenario: Coverage cannot be moved to the day it already started
      Given a bill that began covering a gateway key today
      When an administrator moves that key to another bill from today
      Then the move is refused
      And the administrator is told to pick a later date

  Rule: Which bill covered a key is read as of the day being drawn

    @unit
    Scenario: A past month keeps the bill that covered it at the time
      Given a key covered by one bill until June and by another from June
      When May is drawn
      Then May reads under the first bill
      When June is drawn
      Then June reads under the second bill

    @unit
    Scenario: A key covered by nobody on that day belongs to no bill
      Given a key whose coverage began in June
      When May is drawn
      Then May's gateway spend belongs to no bill

  Rule: The total shown is the bill; gateway detail splits it

    # Every scenario under this rule says what a reader is SHOWN, and nothing
    # shows it yet: there is no connected view, and no caller of the arithmetic
    # behind it. What does exist and is proved is `combineProviderDay` — the
    # split, the variance line, the unclamped refund, the estimated day and the
    # add-up-exactly invariant are all unit-tested against it. So these are
    # parked rather than bound: counting them would report a view as delivered
    # on the strength of tests that draw nothing. They become @unit the day a
    # reader can see the numbers.

    @unimplemented
    Scenario: Gateway detail splits the bill and the remainder is its own line
      Given a bill of six dollars for a provider day
      And four dollars twenty of gateway spend on keys that bill covers
      When the connected view is drawn
      Then the total shown is six dollars
      And four dollars twenty is shown as attributed
      And one dollar eighty is shown as not seen by the gateway

    @unimplemented
    Scenario: Gateway spend above the bill is shown as a variance, never subtracted
      Given a bill of six dollars for a provider day
      And six dollars fifty of gateway spend on keys that bill covers
      When the connected view is drawn
      Then the total shown is still six dollars
      And fifty cents is shown as metering running over the bill
      And nothing is subtracted from the total

    @unimplemented
    Scenario: A refunded day stays negative
      Given a provider day whose bill is a refund
      When the connected view is drawn
      Then the total shown is negative
      # Clamping it to zero would silently eat money.

    @unimplemented
    Scenario: A day the bill has not reached yet is marked estimated
      Given a key covered by a bill
      And gateway spend on a day no bill has reported yet
      When the connected view is drawn
      Then the day shows the gateway figure marked as estimated

    @unimplemented
    Scenario: The estimate becomes the bill when the bill lands
      Given a day shown as estimated from gateway spend
      When the provider's bill for that day arrives
      Then the day shows the bill and is no longer marked estimated

    @unimplemented
    Scenario: Gateway spend no bill covers stands alone
      Given gateway spend on a key no bill covers
      When the connected view is drawn
      Then that spend is shown on its own as metered
      And it is not counted against any bill

    @unimplemented
    Scenario: A bill and its keys in different currencies are not combined
      Given a bill in euros covering keys metered in dollars
      And the provider published no dollar figure of its own
      When the connected view is drawn
      Then the bill and the gateway spend are shown separately in their own currencies
      And no split is shown for that day

    @unimplemented
    Scenario: The parts of a day always add up to its total
      Given any provider day with a bill
      When the connected view is drawn
      Then the attributed part and the part not seen by the gateway add up to the total exactly
