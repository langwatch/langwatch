---
name: haven-orb
description: "Read what a person sent from the haven orb on the app page: `haven feedback` notes with selector, viewport, console and requests, and `haven page console|network`. Use when someone says 'haven feedback', 'the haven orb', 'read the notes I left', 'resolve the feedback', 'wait for feedback', 'page console errors', 'failed requests on the page', 'haven page', or 'what did I point at'."
user-invocable: true
argument-hint: "feedback list --open | show <id> | resolve <id> | wait | page console|network"
---

# The haven orb: feedback and page buffers

When haven runs a watching, non-built stack, the app page carries the haven orb, bottom right
(`apps/ui/vite/haven-orb/`, `specs/setup/haven-dev-orb.feature`). A reader picks an element or
drags a region, types a note, and it lands in this stack's store. The orb also pushes the page's
last 200 console messages and requests: method, URL without its query, status, duration. Never a
body, a header or a cookie.

While building UI, read it before you call the work done:

```bash
haven feedback list --open --agent      # notes nobody resolved yet
haven feedback show <id> --agent        # one note: selector or region, viewport, console, requests
haven feedback resolve <id>             # once you fixed it
haven feedback wait --timeout 5m        # block until the reader sends the next note (default 30s)
haven page console --level error --agent   # levels: error, warn, info, log, debug
haven page network --failed --agent
```

- `--json` and `--stack <slug>` work on all of them.
- The page buffer is whichever tab pushed last, and is empty until someone opens the app with the
  orb showing. The files live in `.haven/logs/<slug>/orb/`.
- A `--ui=built` stack has no orb, so no feedback (`haven-lifecycle`, UI modes). Without a person's
  tab, drive the page yourself with `haven-browser`.
