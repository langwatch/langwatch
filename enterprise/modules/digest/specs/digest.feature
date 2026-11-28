Feature: Weekly digest emails
  LangWatch Cloud sends each person a weekly email for each organization they are in, about that
  organization's week alone and naming it: one feed of up to five rows picked from what their data
  shows (ADR-003), sent through our own mailer. Every organization is in: there is no enrolment. Operators arm
  the send in Cloud admin; nothing is sent until they do. A person opts out once, for every
  organization, in one click from the email or with a switch in their settings; an unsubscribe is
  recorded.
  Design: dev/docs/plans/weekly-digest.md

  # Built: the row pick, the folds' redelivery rule, the weekly send through our own mailer, the
  # one-click unsubscribe and its rate limit, the operators' switch and clearing digest rows on
  # user erasure, and the settings switch. The other folds' peer intake, click tracking and its
  # rate limit, and the Cloud admin gallery and its metrics are @unimplemented.

  # Picking the rows

  @unit
  Scenario: A thin organization is asked to add an eval
    Given one project with 37 traces this week, 12 last week, and no eval or scenario run in five weeks
    When its member's email is built
    Then its rows are Set up with an "Add an eval" button, the project's traces, and New
    And the New row offers "Write your first scenario" as a text link, never a button

  @unit
  Scenario: An organization with no traces this week or last is sent nothing
    Given an organization whose projects sent no traces this week or last
    When a member's rows are picked
    Then none is picked and no email is sent

  @unit
  Scenario: A moderate organization sees its regressions, a quiet project and its traces
    Given a project whose scenario failure rate rose from 6% to 19% and whose tone eval fell from 93% to 81%
    And a second project that sent 640 traces last week and none this week
    When a member's email is built
    Then its rows are the scenario regression with "See the failing runs", the eval drop with no button, the quiet project, the traces and New
    And the "Also this week" line names the eval that held steady

  @unit
  Scenario: A flooded organization's admin sees the plan first and at most two buttons
    Given an organization at 94% of its plan with failing scenarios, a dropped eval, a quiet project and a heavy coding-agent week
    When an admin's email is built
    Then it shows five rows, the plan first with "Raise the limit" and, after a plain "or", a "choose which traces to keep" link
    And no more than two rows carry a button

  @unit
  Scenario: Only an admin near the plan limit sees the plan row, and first
    Given an organization at 80% or more of a plan with a limit
    When an admin's rows are picked
    Then the plan row is first, and at 79.9% there is none
    And a member, or an admin on a plan with no limit, never gets a plan row

  @unit
  Scenario: Rows cut by the cap are named in the Also line, and a cut New row is dropped
    Given more than five rows with something to say
    When the email is built
    Then the five highest in priority show and each row cut is named by its title in the "Also this week" line
    And a New row that does not fit appears nowhere

  @unit
  Scenario: A move of exactly 10 points shows a row, and 9.9 does not
    Given a project whose scenario failure rate is 10 points above its runs-weighted four-week baseline
    When the rows are picked
    Then it has a scenario regression row, and a move of 9.9 points has none

  @unit
  Scenario: A project with no scenario history has no scenario row
    Given a project with scenario runs this week and none in the four weeks before
    When the rows are picked
    Then it has no scenario row

  @unit
  Scenario: An eval with fewer than 20 checks this week or in its baseline has no row
    Given an eval whose pass rate moved by more than 10 points
    When it had fewer than 20 checks this week or in the four weeks before
    Then it has no row and is not called steady

  @unit
  Scenario: An eval steady on two projects is counted once
    Given the faithfulness eval held its rate on two projects
    When the rows are picked
    Then "Also this week" counts it as one steady eval, its checks summed across the two

  @unit
  Scenario: At most two regressions show, biggest first, and the rest fold
    Given three scenario or eval rates that got 10 points worse or more
    When the rows are picked
    Then the two biggest moves show, biggest first, and the third folds into the last line

  @unit
  Scenario: A recovery shows without a button
    Given a scenario failure rate 10 points or more below its baseline
    When the email is built
    Then it shows as a recovery after the traces row, with no button

  @unit
  Scenario: A project is quiet only when last week's count was read and above none
    Given projects with no traces this week
    When the rows are picked
    Then only the one whose last week was read and had traces is called quiet

  @unit
  Scenario: The setup row shows only where no eval ran on any visible project in five weeks
    Given an organization with traces this week
    When no eval ran on any project the reader may view, this week or in the four before
    Then the busiest project gets a Set up row asking for an eval, and none when any eval ran

  @unit
  Scenario: A coding-agent row never shows cost
    Given a member with 5 or more coding-agent sessions this week, which cost money
    When their email is built
    Then their coding-agent row shows sessions, tokens, and commits, pull requests and a top repository when reported
    And neither the row, the subject nor the preview shows "$" or a cost
    And 4 sessions show no row

  @unit
  Scenario: A coding-agent week names the repository with the most sessions
    Given a member whose coding-agent sessions this week ran in three repositories
    When their coding-agent row is built
    Then its top repository is the one with the most sessions

  @unit
  Scenario: Every weekly digest says why it arrived, whatever the reader's role
    When every weekly digest fixture is rendered
    Then its footer says "You get this because you're in" the organization, never that they are a member
    And it offers to turn off the weekly digest
    And its outlined chips and the "Also this week" divider take the dark cut's colours

  @unit
  Scenario: The studio's fixtures are what the digest's rules build
    Given the thin, moderate and flooded organizations' weeks
    When each is built for an admin and for a member by the digest's own rules
    Then each equals the mail studio's fixture of that name

  @unit
  Scenario: A row whose project has no name is left out of the email
    Given a week whose only project's name cannot be read
    When the email is built
    Then its rows are left out, and with nothing else to show no email is sent

  @unit
  Scenario: The plan row and the subject never name the organization twice
    Given an admin of Acme at 90% of its plan
    When their email is rendered
    Then its subject is "Acme: You have used 90% of this month's traces", naming Acme once, in the prefix
    And no row's title has a colon of its own, so every subject has the prefix's one colon at most

  # Folding the week

  @unit
  Scenario: Trace spans are never folded
    Given a span fact stored before spans stopped being folded
    When the project's week folds it
    Then the fact still parses and the week is unchanged

  @integration
  Scenario: Trace numbers are read from analytics, never folded
    Given analytics answers a project's week with its traces, errors, tokens, cost, durations and models
    When a member's traces email is built
    Then it shows exactly those numbers, the change on the week before's traces
    And each project's week is read once however many members are sent to

  @integration
  Scenario: An email counts only the live, shared or own projects the recipient may view
    Given an organization with a project, another member's personal project, an archived project and a governance project
    When an admin of the organization is sent the week
    Then the email shows the shared project alone and analytics is not asked about the others
    And a member is still shown their own personal project

  @integration
  Scenario: An aggregate project is never read for an email
    Given an organization with a project and an aggregate project reading its members
    When an admin of the organization is sent the week
    Then the email shows the project alone and analytics is not asked about the aggregate
    And a member whose only project is an aggregate is sent nothing and nothing fails

  @integration
  Scenario: A failed read of last week drops the change line, not the email
    Given analytics cannot answer the week before the sent one
    When a member is sent the week
    Then the email is sent without its change on last week

  @integration
  Scenario: A failed read of the sent week fails the send for a retry
    Given analytics cannot answer the sent week
    When a member's send is handled
    Then it fails, no email is sent and the week is not claimed

  @integration
  Scenario: Analytics is read a few reads at a time
    Given an organization with thirty projects
    When a member is sent the week
    Then no more than eight analytics reads run at once

  @integration
  Scenario: A plan keeps walking past a failure, then fails once so it retries
    Given an organization, or a member, whose ask cannot be made
    When the plan runs
    Then every other ask is made, the plan fails once at the end and the week is not marked planned
    And the retry asks only what was missed

  @integration
  Scenario: A project whose week cannot be read is left out of the email
    Given analytics cannot answer one of two visible projects' sent week
    When a member is sent the week
    Then the email is about the readable project alone

  @integration
  Scenario: A send fails for a retry when no visible project's week can be read
    Given analytics cannot answer any visible project's sent week
    When a member's send is handled
    Then it fails and no email is sent

  @integration
  Scenario: Each organization is planned as its own intent, a page of ids at a time
    Given three organizations whose ids are paged one at a time
    When the hourly plan runs
    Then one plan is asked for each organization

  @integration
  Scenario: A quiet week sends nothing
    Given analytics answers a project's week with no traces
    When a member's send is handled
    Then no email is sent and no model breakdown is asked for

  @integration
  Scenario: Coding-agent facts fold into the person's week
    Given coding-agent facts contributed for one user across three sessions
    When the digest subscriber has handled their events
    Then the user's week holds 3 sessions and the summed tokens, cost and lines

  @unit
  Scenario: A person's week past its series cap reads its totals as floors
    Given a person's week that received more coding-agent metric series than it keeps
    When their coding-agent row is built
    Then its totals are the sums of the series it kept, each shown as "at least"
    And a week whose series all fit shows its totals without "at least"

  @unit
  Scenario: Impersonating staff can see a person's email choice but not change it
    Given staff impersonating a person
    When they read and set the person's weekly digest preference
    Then the read shows the person's own choice and the write is refused

  @unit
  Scenario: A coding-agent repository is named with its owner when one was reported
    Given coding-agent facts stamped with a repository
    When they are folded into the person's week
    Then the repository is named owner/name when an owner was reported, and by name alone if not

  @unit
  Scenario: A coding-agent metric the digest does not sum is not folded
    Given a coding-agent metric series whose name the coding-agent contract does not normalise
    When it is folded into the person's week
    Then no series is added

  @integration
  Scenario: Scenario outcomes fold into the project's week
    Given scenario runs that finished passing and failing this week
    When the digest subscriber has handled their events
    Then the project's week holds the passed and failed counts

  @integration
  Scenario: A redelivered event is not counted twice
    When the same evaluation completed event is delivered twice
    Then the project's week counts it once

  @integration
  Scenario: A project of an organization that was never enrolled folds
    Given a project whose organization was never enrolled
    When its evaluation completes
    Then its week is folded under its organization

  @integration
  Scenario: A project that belongs to no organization folds nothing
    Given a project that names no organization
    When its evaluation completes
    Then no week is folded for it

  @integration
  Scenario: A fold holds numbers and ids, never personal data
    When any week is folded
    Then no fold row carries an email address or a name

  @integration
  Scenario: Weeks older than the sent week's baseline are swept
    Given folds for the last seven ISO weeks, this one included
    When the hourly wake runs after Monday 08:00 UTC
    Then the sent week, the four weeks its scenario baseline reads and this week remain

  # Sending

  @integration
  Scenario: Nothing is sent while the send is disarmed
    Given the week is built and the send is not armed
    When the scheduled wake runs
    Then no email is sent

  @integration
  Scenario: An organization that was never enrolled is sent to
    Given the send is armed and an organization that was never enrolled with three members
    When the scheduled wake runs
    Then each member receives an email for it

  @integration
  Scenario: Each member gets one email a week
    Given the send is armed and an organization with three members
    When the scheduled wake runs twice
    Then each member receives exactly one email for this ISO week
    And every email carries an RFC 8058 one-click unsubscribe

  @integration
  Scenario: Arming before Monday 08:00 UTC sends last week once, from 08:00
    Given an organization with three members
    When the send is armed at 03:00 UTC on a Monday and the wake runs every hour
    Then nothing is planned before 08:00
    And from 08:00 each member receives exactly one email, for last week

  @integration
  Scenario: A send retried after the mailer failed is not sent twice
    Given a member's email was rendered, their week claimed and the email handed to the mailer
    When the mailer call fails and the send is retried, or two attempts run at once
    Then the member receives exactly one email for that week

  @integration
  Scenario: An email that cannot be rendered claims nothing and is sent on a retry
    Given the send is armed and a member whose email the template or the mailer's command refuses
    When their send is handled
    Then the attempt fails, no send is recorded for them and no email is sent
    And once it renders, the retried send mails them exactly once

  @integration
  Scenario: A send without a public base URL is refused by name
    Given the send is armed and no public base URL is configured
    When a member's send is handled
    Then it is refused with digest_public_base_url_missing
    And no email is sent and no send is recorded for them

  @integration
  Scenario: An organization admin near the plan limit is sent the plan's numbers
    Given the send is armed and an organization at 90% of its monthly limit
    When the week's emails are sent
    Then its admin's email leads with the plan row, its count and its limit
    And its subject names the organization once: "Acme: You have used 90% of this month's traces"
    And its other members get no plan row

  @integration
  Scenario: A member with coding-agent sessions is sent their coding-agent week
    Given the send is armed and a member with 5 coding-agent sessions in two repositories
    When their send is handled
    Then their email has a coding-agent row with their sessions and metric totals, and no cost
    And it names the repository where most of their sessions ran

  @integration
  Scenario: A member's week never carries another member's coding-agent usage
    Given another member of the organization had 5 coding-agent sessions
    When a member's week is read
    Then it holds no coding-agent week but the member's own

  @integration
  Scenario: A member's week is sent though the plan cannot be read
    Given the plan's usage cannot be read
    When a member's send is handled
    Then their week is sent, since only an admin is shown the plan
    And an admin's send fails, for the outbox to retry

  @integration
  Scenario: An unsubscribed member is skipped
    Given the send is armed and a member who unsubscribed
    When the week's emails are sent
    Then that member receives none

  @integration
  Scenario: A member who left or was disabled after planning is skipped
    Given the week's sends are planned for an organization
    When a member leaves it, or is disabled, before their send is handled
    Then that member receives none

  @integration
  Scenario: A member's role is read when their email is sent
    Given the week's sends are planned while a member is an organization admin
    When they become a plain member before their send is handled
    Then their email has no plan row

  @integration
  Scenario: A member's email shows only the projects they may view
    Given a project whose scenarios got worse this week
    And a member who may not view that project
    When the week's emails are sent
    Then that member's email does not name the project
    And a member who may view it is sent its scenario row

  @integration
  Scenario: Disarming after the week is planned sends nothing more
    Given the week's sends are planned for an organization
    When the send is disarmed before its sends are handled
    Then no member receives one

  @integration
  Scenario: A member whose week has nothing to show is sent nothing
    Given the send is armed and a member whose week has no row besides New
    When the week's emails are sent
    Then that member receives none and no send is recorded for them

  @integration
  Scenario: A member of two organizations is sent one email per organization
    Given a member of two organizations, each with its own week
    When the week is planned and both organizations' sends are handled
    Then they receive two emails, one per organization
    And each shows only that organization's week and names it in the subject
    And the two sends carry distinct keys: digest:{userId}:{organizationId}:{isoWeek}

  @integration
  Scenario: The resend of the same member, organization and week is dropped
    Given a member's send for one organization was handled
    When the same send is handled again, or the week is planned again
    Then they receive that organization's email once

  @integration
  Scenario: An opted-out member receives none, in any organization
    Given a member of two organizations who opted out
    When both organizations' sends are handled
    Then they receive none

  @integration
  Scenario: An organization without a name is sent its rows under a plain heading
    Given an organization the organization module has no name for, near its plan limit
    When its admin's email is sent
    Then it leads with the plan row and its subject carries no organization name

  @integration
  Scenario: A deactivated person is sent nothing
    Given the send is armed and a member whose profile is deactivated
    When the week's emails are sent
    Then that member receives none and no send is recorded for them

  @integration
  Scenario: A member with no email address is skipped
    Given the send is armed and a member the user module has no record of
    When the week's emails are sent
    Then that member receives none
    And the organization's other members are each sent theirs

  @integration
  Scenario: One unreadable organization does not stall the others' plan
    Given two organizations, the first of which cannot be read
    When the scheduled wake runs
    Then the other organization's sends are asked
    And the unreadable one's own plan fails and is retried alone, without asking the first twice

  @integration @unimplemented
  Scenario: Every link in a sent email is a tracked redirect
    When a digest email is sent
    Then every link in it points at /api/digest/c/ with a token
    And no token carries the target address

  # Unsubscribe and clicks

  @integration
  Scenario: One-click unsubscribe from the mail client
    When a POST with a valid unsubscribe token arrives
    Then the member is unsubscribed from every organization's digest and the send it came from is recorded

  @integration
  Scenario: The email's footer link opens the person's email preferences
    When a digest email is sent
    Then its footer link is /settings/profile#email-preferences
    And its List-Unsubscribe header is still the signed one-click address

  @integration
  Scenario: A person turns the weekly digest off and on in their settings
    Given a signed-in person on their Profile page
    When they turn the Weekly digest switch off and on again
    Then each choice is saved as their one opt-out, the same one the unsubscribe link writes
    And a failed save leaves the switch where it was and says so
    And the call names no user: it is always the signed-in person's own

  @integration
  Scenario: A forged or tampered unsubscribe token is refused
    When the unsubscribe page is asked with a token whose signature does not match
    And the same holds for a token signed with that secret for another purpose
    Then the answer is refused as an invalid link
    And no subscription changes

  @integration
  Scenario: An expired unsubscribe link is refused
    Given an unsubscribe link minted 180 days ago
    When it is asked or posted
    Then the answer is refused as an invalid link
    And no subscription changes

  @integration
  Scenario: Without a signing secret no link is signed or honoured
    Given no session secret is configured
    When a member's week is sent, or the unsubscribe address is asked
    Then no email is sent and no send is recorded
    And the address answers 503, its digest_links_unavailable code masked like any platform fault

  @unit
  Scenario: The unsubscribe page cannot be framed
    When any unsubscribe or resubscribe page is answered
    Then it carries X-Frame-Options DENY and a frame-ancestors 'none' policy

  @unit
  Scenario: The unsubscribe pages are neither cached nor leak their address
    When any unsubscribe or resubscribe page is answered
    Then it carries Cache-Control no-store and Referrer-Policy no-referrer

  @integration
  Scenario: Resubscribing from the unsubscribe page
    Given a member who unsubscribed
    When they resubscribe from the same page
    Then they receive next week's email

  @integration
  Scenario: A link for a person who no longer exists is refused as an invalid link
    Given a valid unsubscribe link for a person who no longer exists
    When the page is asked, or the link is used to unsubscribe or resubscribe
    Then the answer is refused as an invalid link
    And no subscription row is written for them

  @integration @unimplemented
  Scenario: A tracked link records a click and redirects
    When a valid click token for a sent email's link is followed
    Then a click is recorded for that send and link
    And the answer redirects to the link's stored address

  @integration @unimplemented
  Scenario: A click token for an unknown link key never redirects
    When a click token names a link key its send does not hold
    Then the answer is not found and nothing redirects

  @integration
  Scenario: The unsubscribe pages are rate limited, and a refused call touches nothing
    When one caller asks, unsubscribes or resubscribes past the limit
    Then the caller is refused as digest_unsubscribe_rate_limited
    And the token is not verified, no subscription is read, and nothing is written

  @unit
  Scenario: Unsubscribe still works when the attempt counter is unavailable
    Given the attempt counter fails
    When a member unsubscribes with a valid token
    Then the member is unsubscribed and no error is raised

  @integration @unimplemented
  Scenario: The click route is rate limited
    When one caller asks the click route past the limit
    Then the caller is refused as too many requests

  # Cloud admin

  @unit
  Scenario: The digest admin is refused where cloud ops is off
    Given ops's cloud-ops capability is off
    When staff on the ops list arm the send
    Then the call is refused with not_found

  @unit
  Scenario: Only operators on the ops list use the digest admin
    Given a signed-in user who is not on the ops back-office list
    When they arm the send
    Then the call is refused with not_found

  @unit
  Scenario: Someone who is not staff is answered not-found by the digest admin door
    Given a signed-in person who is not Cloud admin staff
    When they arm the send, send a test, or send themself their own or a person's digests
    Then each call is refused with not_found and the digest is never reached

  @unit
  Scenario: A digest admin write needs ops:manage, not ops:view
    Given Cloud admin staff who hold ops:view but not ops:manage
    When they arm the send, send a test, or send themself their own or a person's digests
    Then each call is refused with permission_denied and the digest is never reached

  @unit
  Scenario: Staff holding ops:manage reach the digest as themselves
    Given Cloud admin staff who hold ops:manage
    When they arm the send, send a test, or send themself their own or a person's digests
    Then each call reaches the digest, naming them as the operator

  @unit
  Scenario: The digest asks ops to admit the operator behind every admin control
    Given Cloud admin staff the platform door admits, where ops's cloud-ops capability is off
    When they arm the send, send a test, or send themself their own or a person's digests
    Then each call is refused with not_found and nothing is armed or sent

  @unit
  Scenario: An operator arms and disarms the weekly send
    Given an operator ops admits to manage the digest
    When they arm the send and then disarm it
    Then each call answers the settings with the switch as set
    And the stored switch matches it

  @integration @unimplemented
  Scenario: The gallery previews a person's email for every eligible template
    Given an organization's folds for last week
    When an operator previews a member's email
    Then every template the member is eligible for is rendered, with the picked one marked

  @integration @unimplemented
  Scenario: The cohort sorts by coding-agent cost
    Given three organizations with different coding-agent cost this week
    When the cohort is read sorted by coding-agent cost descending
    Then the organizations come back highest cost first

  @integration
  Scenario: Sending a test goes only to the operator
    When an operator sends themself a test of a member's email for an organization
    Then only the operator receives it
    And no DigestSend row is written

  @integration
  Scenario: A test send respects a member's opt-out
    Given an organization and a member who unsubscribed
    When an operator sends themself a test of that member's email
    Then the call is refused with digest_member_unsubscribed
    And no email is sent

  @integration
  Scenario: A test send of someone who is not a member is refused
    Given an organization
    When an operator sends themself a test of a person who is not its member
    Then the call is refused with digest_member_not_found
    And no email is sent

  @integration
  Scenario: A test send to an operator with no email address is refused
    Given an organization
    When an operator whose account has no email address sends themself a test of a member's email
    Then the call is refused with digest_operator_address_missing
    And no email is sent

  @integration
  Scenario: A test send of a member whose pick has nothing to show is refused
    Given an organization and a member whose pick has nothing to show this week
    When an operator sends themself a test of that member's email
    Then the call is refused with digest_nothing_to_send
    And no email is sent

  @integration
  Scenario: A test email's unsubscribe link names the operator, not the member
    Given an organization
    When an operator sends themself a test of a member's email
    And the test email's one-click unsubscribe is followed
    Then the operator is unsubscribed and the member is not

  @integration
  Scenario: An operator sends themself every digest they would get
    Given an operator who is a member of two organizations, each with a busy week
    When they send themself their digests
    Then they receive one test per organization, picked as their own weekly email would be
    And each subject names its organization and is marked [Test]
    And the answer lists each organization by name with the template it was sent with
    And no DigestSend row is written

  @integration
  Scenario: An organization with nothing to send is skipped and reported
    Given an operator in two organizations, one of which has nothing to show them this week
    When they send themself their digests
    Then they receive the one with something to show
    And the other is reported as skipped with nothing to send, not as an error

  @integration
  Scenario: An operator who opted out is sent none of their digests
    Given an operator in two organizations who opted out of the digest
    When they send themself their digests
    Then no email is sent
    And each organization is reported as skipped because they opted out

  @integration
  Scenario: One organization failing does not keep the operator's other digests from going
    Given an operator in two organizations, one of whose weeks cannot be read
    When they send themself their digests
    Then they receive the other organization's test
    And the unreadable one is reported as failed

  @integration
  Scenario: An operator's hidden system organization is not sent
    Given an operator in two organizations, one of which is the install's hidden system organization
    When they send themself their digests
    Then only the other organization's test is sent and listed, as the weekly send would mail them

  @integration
  Scenario: Sending yourself your digests without an email address is refused
    Given an operator whose account has no email address
    When they send themself their digests
    Then the call is refused with digest_operator_address_missing
    And no email is sent

  @integration
  Scenario: Staff with ops:manage send themselves their digests from their settings
    Given Cloud admin staff holding ops:manage on their Profile page
    When they press "Send me my digests" under Email preferences
    Then each of their organizations is listed with what was sent, or why nothing was
    And someone without ops:manage sees no such button

  @integration
  Scenario: Staff send themselves a person's digests as that person would get them
    Given a member in two organizations, each with a busy week, and an operator
    When the operator sends themself the member's digests by the member's email, as they would get them
    Then the operator receives one test per organization, picked as the member's weekly email would be
    And the member is sent nothing
    And the answer names the member and lists each organization with the template it was sent with

  @unit @integration
  Scenario: Staff send a person's digests to the person, not to themselves
    Given a member in two organizations, each with a busy week, and an operator
    When the operator sends the member's digests to the person
    Then the member receives one test per organization at their own address, marked [Test]
    And the operator is sent nothing
    And an address typed in is never accepted as where to send

  @integration
  Scenario: A test send to a deactivated person is skipped
    Given a member whose account is deactivated
    When the operator sends the member's digests to the person
    Then each organization is reported as skipped because the account is deactivated
    And no email is sent

  @integration
  Scenario: A test send to yourself of a deactivated person's digests still works
    Given a member whose account is deactivated
    When the operator sends themself the member's digests
    Then the operator receives one test per organization

  @integration
  Scenario: A test send to a person with no email address is skipped
    Given a member whose account has no email address
    When the operator sends the member's digests to the person
    Then each organization is reported as skipped because they have no address
    And no email is sent

  @unit @integration
  Scenario: Staff send a person every row with data, past the thresholds
    Given an admin of an organization at 1% of its plan
    When the operator sends themself the admin's digests with every row
    Then the test leads with the plan row the weekly send leaves out below 80%
    And every row with data shows, past the thresholds and the five-row cap
    And a member is still sent no plan row

  @integration
  Scenario: An every-row test with no data for the person is skipped, not sent
    Given a member of two organizations, one of which has nothing at all for them this week
    When the operator sends themself the member's digests with every row
    Then the one with data is sent
    And the other is reported as skipped with no row with data

  @integration
  Scenario: Sending a person's digests to an address no account has is refused
    Given an address no account has
    When an operator sends themself that person's digests
    Then the call is refused with digest_person_not_found
    And no email is sent

  @integration
  Scenario: Staff send themselves a person's digests from their settings
    Given Cloud admin staff holding ops:manage on their Profile page
    When they enter a person's email, choose what they'd get or every row, and press "Send test to me"
    Then the person and each of their organizations are listed with what was sent, or why nothing was

  @integration
  Scenario: Staff choose to send a person's digests to them from their settings
    Given Cloud admin staff holding ops:manage on their Profile page
    When they enter a person's email and choose "Send to them"
    Then the button reads "Send test to them" and the tests go to that person, not to the staff member

  @integration @unimplemented
  Scenario: Metrics count sends, unique clickers and unsubscribes by template and week
    Given ten sends of digest-week this week, three members who clicked twice each and one unsubscribe
    When the metrics are read
    Then digest-week shows 10 sent, 3 clickers, a 30% click rate and 1 unsubscribe

  # User erasure

  @integration
  Scenario: Digest rows naming an erased person are cleared
    Given a person with an opt-out, sends and folded weeks in two organizations
    When user records that person erased, delivered twice
    Then their subscription, sends and weeks are deleted in both organizations
    And another person's rows remain and no email is sent

  @integration
  Scenario: Clearing digest rows for a person digest holds nothing for changes nothing
    Given digest rows naming another person
    When digest clears rows for a person no digest row names
    Then every other row remains as it was
