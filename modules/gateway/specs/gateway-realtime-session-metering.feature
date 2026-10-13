Feature: Gateway realtime-session metering

  A realtime voice call runs for minutes while its client, or the gateway
  holding its socket, reports what each response used. Every report is its own
  spend record, so the budgets on the key see the call's spend while it runs,
  and a session that never reports is charged an estimate instead of nothing.
  ADR-097 carries the reasoning.

  Rule: Each usage report is recorded once, as its own spend record

    @unit
    Scenario: A keyed report is confirmed as its own spend record and leaves the session open
      Given an open realtime session
      When a usage report arrives naming the response it belongs to
      Then one spend record named by the session and the response is confirmed
      And it carries the session's organization, key, team, owner and trace
      And the session stays open

    @unit
    Scenario: Two reports with the same response id count once
      Given a usage report was recorded for a response
      When the same report is delivered again
      Then nothing more is confirmed and the answer says duplicate
      And the session's recorded cost is unchanged

    @unit
    Scenario: A report after the session closed records nothing
      Given a session that has closed
      When a usage report arrives for it
      Then nothing is confirmed and the answer says already closed

    @unit
    Scenario: A report key is reduced to the characters a spend record id may carry
      When a report key carries characters outside letters, digits, underscore and hyphen
      Then they are dropped and the key is cut at 128 characters

    @unit
    Scenario: A transcription report is priced under the session's transcription model
      Given a session that declared a transcription model
      When a report priced as transcription arrives
      Then it is rated under the transcription model, not the session's model
      And a report that names a model of its own is rated under that one

    @unit
    Scenario: A final report records its usage and closes the session
      When a report marked final arrives
      Then its usage is recorded as a report
      And the session closes with its own record confirmed at no quantities

    @unit
    Scenario: A bare close records no usage
      When a report marked final arrives with no usage
      Then the session closes and no report is recorded

    @integration
    Scenario: The internal usage route answers what the report did and what it cost
      Given a session booked with its kind, metering and transcription model
      When the gateway posts a keyed usage report to the internal usage route
      Then it answers the report's status, its cost, the session's cost so far and the budget verdict
      And the same report posted again answers duplicate at no cost
      And a report for a session that does not exist answers 404 realtime_session_not_found

    @integration
    Scenario: A gateway that sends none of the new fields still books and closes a session
      When a reservation and a usage report arrive carrying only the fields an older gateway sends
      Then the session is booked with no kind
      And the single report closes it

    @integration
    Scenario: A credential expiry can be recorded on its own
      When a patch carries only the credential's expiry
      Then the session records it and stays open

  Rule: A session total closes the session on its own record

    @unit
    Scenario: A session total with no earlier reports confirms the whole total
      Given an open session with no reports
      When a usage report arrives with no report key
      Then the whole usage is confirmed on the session's own record
      And the session closes

    @unit
    Scenario: A session total after keyed reports confirms only what they left out
      Given keyed reports already recorded part of a session's usage
      When a usage report arrives with no report key
      Then only the quantities the reports did not record are confirmed on the session's own record
      And a quantity the reports already exceeded is confirmed at zero

  Rule: A usage report answers where the key's budgets stand

    @unit
    Scenario: A report that takes a blocking budget to its limit says so
      Given a blocking budget on the key's chain
      When a report's cost takes the budget's spend to its limit
      Then the answer flags the budget as exceeded and names its scope and id

    @unit
    Scenario: The session's recent reports count before the ledger holds them
      Given the budget ledger has not been debited for a report recorded a moment ago
      When the budgets are read for the next report
      Then that report's cost is counted on top of the ledger's spend

    @unit
    Scenario: A budget read that fails answers unknown rather than a guess
      Given the budgets cannot be read
      When a usage report is recorded
      Then the report is still recorded
      And the answer marks the budget verdict unknown and not exceeded

  Rule: A session's spend belongs to the end user its mint named

    @unit
    Scenario: Every spend record of a session carries the mint's end user
      Given a realtime session whose mint named an end user
      When a keyed report, then the session total, are recorded
      Then each spend record carries that end user id

    @unit
    Scenario: A session minted with no end user records none
      Given a realtime session whose mint named no end user
      When a usage report is recorded
      Then its spend record carries an empty end user id

    @unit
    Scenario: An estimate is attributed to the mint's end user
      Given a client-metered session whose mint named an end user and that never reported
      When the session is settled
      Then the estimate's spend record carries that end user id

    @unit
    Scenario: A report that exhausts the end user's budget says so
      Given a per-end-user budget on the key
      And a realtime session whose mint named an end user
      When a report's cost takes that end user's bucket to its limit
      Then the budget read names the session's end user
      And the answer flags the budget as exceeded with scope attributed_user

    @integration
    Scenario: The internal reserve route stores the end user the gateway sends
      When the gateway books a session with an end user id and reports usage on it
      Then the session row holds that end user id
      And the report's spend record carries it

  Rule: A session that stops reporting is still settled

    @unit
    Scenario: A client-metered session that never reported settles at an estimate
      Given a client-metered realtime session past the open window with no reports
      When the reconciler runs
      Then an estimate is recorded as the session's one report
      And the session closes for the reason that no usage report arrived

    @unit
    Scenario: The estimate follows the session's kind and its credential's lifetime
      Then a realtime session is charged ten input audio tokens a second and twenty output audio tokens a second for half the call
      And a live, a speech-to-text socket and a batch speech-to-text session are charged their duration as audio
      And a text-to-speech socket is charged fifteen characters a second
      And the assumed call is the credential's lifetime, never under a minute or over an hour
      And a kind with no rule is not estimated

    @unit
    Scenario: A session whose reports stopped closes at what was recorded
      Given a client-metered session past the open window that recorded reports
      When the reconciler runs
      Then no estimate is recorded
      And the session closes with its own record confirmed at no quantities

    @unit
    Scenario: A gateway-metered session is never estimated
      Given a gateway-metered session past the open window with no reports
      When the reconciler runs
      Then the session closes at what was recorded and no estimate is charged

    @unit
    Scenario: A session expired under the cap lock is still settled
      Given the key's next mint expired a metered session that outlived the window
      When the reconciler runs
      Then the expired session is settled and closed

    @unit
    Scenario: A session released by the gateway is not estimated
      Given a metered session the gateway released because its credential was never used
      When the reconciler runs
      Then the session is left as released and nothing is charged

    @unit
    Scenario: A session booked without a kind is left to the vendor report
      Given a session with no kind past the open window
      When the reconciler runs
      Then it is expired as before and nothing is charged

    @unit
    Scenario: A gateway-held session that went silent is closed at its recorded usage
      Given an open live session the gateway meters whose last report is over three minutes old
      When the reconciler runs
      Then the session closes for the reason that the gateway lost it
      And nothing beyond its recorded reports is charged

    @unit
    Scenario: A gateway-metered call still reporting past the open window stays open
      Given an open session the gateway meters that was booked over an hour ago
      And it reported within the last three minutes
      When stale sessions are expired and the reconciler runs
      Then the session stays open

    @unit
    Scenario: A report that measured nothing only marks the session as heard from
      Given an open session the gateway meters
      When a keyed report with no quantities arrives
      Then no spend record is confirmed and no report is stored
      And the session records when it was last heard from

    @unit
    Scenario: The settlement span states the whole call
      Given a session with recorded reports is closed
      Then the one settlement span carries the reports' summed quantities and cost
      And what the session's own record confirmed is added to it
