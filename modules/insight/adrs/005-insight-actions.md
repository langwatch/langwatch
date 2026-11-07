# ADR-005: Actions on an insight continue the Langy conversation, as the clicker

**Status:** Proposed

**Behavioural contract:** [Action buttons on an insight](../specs/insight-actions.feature)

## Context

An insight is a finding Langy wrote. The next step is often obvious to Langy when it
writes it ("find the failing traces", "draft an evaluator"), and the conversation that
made the insight holds the context that step needs. The ask is buttons on the card that
send such a step back to Langy, in the conversation the insight came from. A button that
sends text to an agent is a prompt-injection surface, and the conversation may not be the
clicker's.

## Decision

**Langy proposes, the module stores.** A finding of an `insights` card may carry up to
four `actions`, each `{ label, prompt }`. "Save as insight" passes them into the filing.
The filing strips control and invisible format characters (a prompt keeps line breaks and
tabs), refuses a link to any host but `langwatch.ai` and `app.langwatch.ai`, and enforces the
caps (label 40, prompt 1,000 characters); a field past its cap is refused without its words
being read. `javascript`, `data`, `vbscript`, `file`, `mailto` and `ftp` are refused on sight at
a word's start, which means not after a letter, a digit, `.`, `_`, `/` or `-`, and in any case or
split by a tab: `metadata:x`, `trace.data:x` and `meta-data:x` are words. Any other scheme but
`http` or `https` is refused when two slashes or backslashes follow it, whatever the host;
`path:/api/v1`, `C:/Users/x` and `slack:x` are words. An `http(s):`, `www.` or `host/path` address
runs to the next whitespace or the next `http(s):`, and its host must be allowed, and `https:/x`
counts. So does `//` at a word's start or after `(`, `<`, `[`, `:` or a quote; `input//output` is
words, and so is `//` after any other character, such as `href=//evil.com`, since the card shows
the prompt as plain text and no browser would follow it. `host/path` counts only with a common
ending (`com`, `net`, `org`, `io`, `ai`, `co`, `dev`, `app`, `xyz`, `info`), so `trace.cost/day`
stays words; the accepted cost is that `evil.biz/x` passes, and a bare `evil.com` is not a link
either, since words like "e.g." would match. A browser drops a tab or line break inside an
address, so a tab directly after one is refused, and so is a line break before `.`, `@`, `/`, `:`
or a host name; an ordinary next line is kept. "Save as insight" drops a proposed action the filing would
refuse, rather than failing the whole save. The module mints the ids `a0`..`a3` by position. The actions ride
on the filed event (`actions`, default `[]`) and the renewed event (`actions`, default
`null`, which keeps them), and on `InsightProjection.actions`, a nullable JSON column
filled by replay.

**Nothing is sent but a click, and only stored text.** The card shows each prompt before
the click. `insights.runAction` names the insight and the action id, never the text: the
module reads the prompt from the insight and sends a fixed framing line, a blank line and
the prompt word for word. The browser mints a click id; Langy's idempotency key is
`insight-action:<insightId>:<actionId>:<clickId>`, so a repeated request sends nothing new.

**The turn is always the clicker's, in a conversation of theirs.** The door asks
`analytics:view` and `langy:create`, and the turn runs as the person the session proved.
The clicker owns the source conversation: Langy continues it. They do not: it is forked
for them and the fork is continued once it reads as theirs and its copied messages have
landed. A fork only sends commands the worker folds later, so a click waits about five seconds
for that, with one last read at the end, and a read that fails counts as not ready and logs one
warning per wait, naming the fork; if it is still not ready, a seeded conversation starts, the answer says
`forkNotReady` and names the copy, and the copy is left in place. The source is gone, archived
or not visible: a new conversation starts, seeded with the insight's title, body, query and
window, and the answer says `sourceGone` so the card can say so. Nobody else's conversation is
written to, and nothing is unarchived.

**Nothing comes from a run.** A run's conversation holds trace text nobody vetted, so a run
files and renews with no actions, a chat filing saved from a run's conversation, or from one
it cannot read, keeps none, and `runAction` refuses (`insight_action_from_run`) an insight a run filed or one whose
source is a run's conversation.

**Behind its own flag.** `release_insight_actions`, default off and on top of
`release_insights`: the browser hides the buttons and the server refuses with
`insight_actions_not_enabled`.

## Consequences

- The prompt never gains rights the clicker lacks: Langy acts with their permissions.
- A repeated request of one click on a forked source forks again, though Langy takes the
  message once. Accepted: a stray empty fork is harmless.
- A click whose fork is late answers late: up to the wait, plus one read of a row that has not
  landed. The fork it gave up on stays in the clicker's list.
- A click that answers after the person left the page does not move them or touch the address:
  a toast says Langy has the action and to look under Recent chats in the Langy panel. While
  they stay on the page, the conversation opens with the query of the latest render. The page is
  the screen, not the list: a failed read, the skeleton and the empty page swap the list out, and
  the click stays on its way across them, its actions disabled.
- Langy is taught the `actions` field only where a skill teaches the `insights` card. Today
  that is the daily-insights skill, whose runs keep no actions, so no interactive answer
  proposes actions until a chat skill teaches the card.
