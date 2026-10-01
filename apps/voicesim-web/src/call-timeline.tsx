import { SimJson, SimTime } from "@langwatch/sim-console";

import type { Call } from "./voice-api.ts";

/**
 * One call's detail: its facts, then each turn as caller line and scripted reply,
 * then the protocol events.
 */
export const CallTimeline = ({ call }: { call: Call }) => (
  <article className="voice-call" data-testid="call-timeline">
    <header className="voice-facts">
      <h2>{call.id}</h2>
      <span>agent {call.agentId || "(none)"}</span>
      <span>
        started <SimTime at={call.startedAt} />
      </span>
      <span>
        {call.endedAt ? (
          <>
            ended <SimTime at={call.endedAt} />
          </>
        ) : (
          "live"
        )}
      </span>
      <span>
        {call.callerFrames} caller frames · {call.agentFrames} agent frames
      </span>
    </header>
    {call.turns.length === 0 ? (
      <p className="voice-muted">No turn yet: the caller has not finished speaking.</p>
    ) : (
      <ol className="voice-turns">
        {call.turns.map((turn) => (
          <li key={turn.index} data-testid="call-turn">
            <SimTime at={turn.at} />
            <p>
              <strong>Caller</strong> {turn.callerText}{" "}
              <span className="voice-muted">({turn.callerFrames} frames)</span>
            </p>
            <p>
              <strong>Agent</strong> {turn.agentText}{" "}
              <span className="voice-muted">({turn.agentFrames} frames)</span>
            </p>
          </li>
        ))}
      </ol>
    )}
    <h3>Events</h3>
    <ul className="voice-events">
      {call.events.map((event, position) => (
        <li key={`${position}-${event.type}`}>
          <SimTime at={event.at} /> {event.direction === "in" ? "←" : "→"} {event.type}
        </li>
      ))}
    </ul>
    {call.droppedEvents > 0 && (
      <p className="voice-muted">{call.droppedEvents} later events were not kept.</p>
    )}
    <SimJson value={call} />
  </article>
);
