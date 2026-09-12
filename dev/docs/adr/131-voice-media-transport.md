# ADR-131: Media Transport for Real Phone-Call Testing

**Date:** 2026-09-11

**Status:** Accepted

## Why this ADR exists

This question has been worked out from first principles more than once, because
nothing written down matched a search for "WebRTC" or "SIP". It cost real time
each time. If you are about to reason about whether the voice worker needs to
accept inbound connections, read this instead of re-deriving it.

## Context

Testing a phone agent means placing a real call and exchanging real audio with
it. The open question was the *direction* of the media path: must something dial
in to us, or can we get away with dialling out only?

One constraint settles it:

> Twilio Media Streams only works by Twilio opening a WebSocket **to you**.
> There is no mode where a server pulls audio from Twilio.

So there are two connections in opposite directions for a single call:

```
  us  ──── HTTPS POST /Calls (outbound) ────►  Twilio      we place the call
  us  ◄─── WebSocket to wss://…/twilio/… ───   Twilio      Twilio sends audio
```

Our REST call being outbound does not make the media path outbound. Conflating
the two is the specific confusion this ADR exists to kill.

### This is Twilio's prescribed way, checked against their docs

The question "are we using Twilio the easy, documented way, or fighting it?"
came up after the tunnel landed. It was answered by reading Twilio's own
documentation rather than from memory, and the answer is recorded here so it
is not re-asked.

Twilio's Media Streams overview defines the product as "streaming it over
WebSockets to a destination you specify", and its only infrastructure
requirement is a firewall rule to "allow secure WebSocket connections (TCP port
443) from Twilio to your WebSocket servers from any public IP address". Their
Media Streams tutorial then says, verbatim: "We recommend that you make use of
an ssh tunnel service like ngrok, which supports the wss scheme." A public
`wss://` endpoint, provided by a tunnel when the host has none, is therefore
not a workaround. It is the documented pattern.

There is no Twilio product in which our server dials out to receive audio:

- **Media Streams**: Twilio connects to our `wss://`. Raw audio. What we use.
- **ConversationRelay**, Twilio's newer AI-agent noun: Twilio performs the
  speech-to-text and text-to-speech and sends us text, but it still requires
  "the URL of your WebSocket server. The URL must begin with wss://". Same
  direction, so it removes nothing.
- **Voice SDK over WebRTC**: browser and mobile only (Option A below).
- **SIP**: inbound RTP, so more infrastructure, not less (Option C below).

The one genuinely tunnel-free path is to stop streaming altogether: plain
TwiML webhooks, `<Gather input="speech">` to hear the agent and `<Say>` or
`<Play>` to speak to it. Those are stateless HTTPS POSTs, so they can land on
the app's existing public hostname with per-call state in the database, with
no tunnel, no nonce and no socket handoff. Whole-call recording still works via
the record flag. It is rejected for now because it is a rewrite rather than a
tweak: the SDK adapter is built on raw audio and is the code that passed a real
call; turn-taking becomes coarse, driven by Gather timeouts instead of a live
stream; and both directions of audio become Twilio's voices and Twilio's ears,
so the judge would read Twilio's transcript rather than ours. It is the first
fallback to reach for if the quick tunnel proves unworkable in production,
ahead of any SIP or WebRTC option.

The complexity that did exist came from our side, not Twilio's: production had
no path routing, and the call-to-process routing table lives in worker memory.
The nonce and IPC handoff exist because scenarios run in a child process, which
is our architecture and would exist under any transport.

## What we considered

**Option A: Twilio Voice SDK (WebRTC) in headless Chromium.** Genuinely
outbound-only, needs no ingress at all. Rejected as the primary path because the
SDK is browser- and mobile-only, so every test call needs a real browser driven
headlessly. Kept as a fallback.

**Option B: A WebRTC provider plus a SIP trunk (LiveKit).** The worker joins a
LiveKit room outbound and LiveKit dials the agent under test over SIP. Rejected
on three counts: it adds a second vendor; LiveKit's free tier covers WebRTC
minutes only, and SIP minutes are metered even on paid Cloud; and, decisively,
**self-hosting the SIP bridge does not remove inbound** because it still needs
public UDP for RTP from the carrier. Only LiveKit Cloud actually avoids inbound,
which is the paid, second-vendor option.

**Option C: Direct SIP registration to Twilio.** Genuinely outbound-only and
technically sound. SIP signalling runs over TLS and symmetric RTP latches to the
NAT source, so no ingress is needed. **Rejected on cost, not on feasibility.**
Building a minimal SIP user agent plus a G.711 RTP stack was estimated at one to
two weeks against roughly days for the WebSocket route, and it means owning
telephony edge cases permanently: re-invites, session timers, NAT keepalives.

Option C remains the documented fallback if a security review ever refuses an
inbound listener on a worker. It is the only rejected option that removes the
requirement outright, so it is the one to revive if the requirement itself is
what gets vetoed.

## Decision

Use **inbound Twilio Media Streams**. The voice worker exposes an authenticated
public `wss://` endpoint, and Twilio dials back into it.

Supporting choices are made elsewhere and are deliberately not restated here:
the media listener binds in the worker parent and hands the socket down to the
scenario child, and the per-call nonce travels in the URL path.

## Consequences

- The voice worker needs a publicly reachable, TLS-valid hostname. That is a
  real deployment requirement, not an implementation detail.
- An unreachable or unresolvable stream URL fails almost silently. Twilio
  reports error 31920, the call lasts about a second, and the adapter then burns
  its full connect timeout before giving up. Any new endpoint mechanism must be
  proven globally resolvable *before* a call is placed.
- Because the endpoint faces the internet, the nonce check is load-bearing
  rather than defence in depth.

## How the public endpoint is provided

The transport decision above is settled. How we obtain the hostname is a
separate and softer choice.

Current approach is a free `cloudflared` quick tunnel. The worker shells out to
`cloudflared` at boot, receives a `*.trycloudflare.com` hostname, and uses it as
its public base URL. No account, no load balancer, no certificate to manage.
This is explicitly temporary.

Its real advantage is not avoiding infrastructure work. A tunnel lets *every*
worker publish its own address, which dissolves the single-replica constraint
that a fixed hostname otherwise forces.

This was verified end to end rather than assumed. A quick tunnel carried a real
`wss://` upgrade from the public internet to a local port: the hostname appeared
in about five seconds, became globally resolvable about seven seconds after
that, completed a full frame round-trip on `/twilio/<nonce>`, and refused a
wrong nonce. The DNS wait is mandatory — the hostname is not resolvable the
moment `cloudflared` prints it, which is exactly the error 31920 trap above.

The durable fallback is a single-replica deployment behind a public NLB with its
own certificate and an *unproxied* DNS record. Unproxied matters: proxied records
apply bot rules that return Cloudflare error 1010 to machine clients like Twilio.

Quick tunnels are ephemeral and rate-limited, and Cloudflare does not intend them
for production. Revisit this before the feature is offered generally.
