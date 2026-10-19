import { Badge, KeyValue, Panel, Stack, Table, Text } from "@langwatch/design-system-internal";
import { SimDuration, SimJson } from "@langwatch/sim-console";

import type { Call, CallEvent, Turn } from "./voice-api.ts";

const stamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });
const clock = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
  hourCycle: "h23",
});

const Line = ({
  side,
  text,
  frames,
}: {
  side: "caller" | "agent";
  text: string;
  frames: number;
}) => (
  <div className="voice-line" data-side={side}>
    <span className="voice-speaker">
      {side === "caller" ? "Caller" : "Agent"} · {frames} frames
    </span>
    <p className="voice-bubble">{text}</p>
  </div>
);

const Transcript = ({ turns }: { turns: Turn[] }) =>
  turns.length === 0 ? (
    <Text tone="muted">No turn yet: the caller has not finished speaking.</Text>
  ) : (
    <ol className="voice-transcript">
      {turns.map((turn) => (
        <li key={turn.index} className="voice-turn" data-testid="call-turn">
          <span className="voice-turn-time">
            Turn {turn.index + 1} · {clock.format(turn.at)}
          </span>
          <Line side="caller" text={turn.callerText} frames={turn.callerFrames} />
          <Line side="agent" text={turn.agentText} frames={turn.agentFrames} />
        </li>
      ))}
    </ol>
  );

type EventRow = CallEvent & { position: number };

/** `in` is what the app sent the simulator; `out` is the simulator's answer. */
const eventColumns = [
  {
    key: "at",
    header: "Time",
    width: "9rem",
    mono: true,
    cell: (event: EventRow) => clock.format(event.at),
  },
  {
    key: "direction",
    header: "Direction",
    width: "8rem",
    cell: (event: EventRow) =>
      event.direction === "in" ? <Badge>← received</Badge> : <Badge tone="brand">→ sent</Badge>,
  },
  { key: "type", header: "Event", mono: true, cell: (event: EventRow) => event.type },
];

/** One call: its facts, the conversation, the protocol events, then the raw call. */
export const CallTimeline = ({ call }: { call: Call }) => (
  <article data-testid="call-timeline">
    <Stack gap={4}>
      <Panel
        title={call.id}
        meta={call.endedAt ? <Badge>ended</Badge> : <Badge tone="ok">live</Badge>}
      >
        <KeyValue
          items={[
            { label: "Agent", value: call.agentId || "(none)" },
            { label: "Started", value: stamp.format(call.startedAt), mono: false, copy: false },
            {
              label: "Ended",
              value: call.endedAt ? stamp.format(call.endedAt) : "Still connected",
              mono: false,
              copy: false,
            },
            {
              label: "Duration",
              value: <SimDuration from={call.startedAt} to={call.endedAt} />,
              mono: false,
            },
            {
              label: "Frames",
              value: `${call.callerFrames} caller · ${call.agentFrames} agent`,
              mono: false,
              copy: false,
            },
          ]}
        />
      </Panel>
      <Panel title="Transcript" meta={`${call.turns.length} turns`}>
        <Transcript turns={call.turns} />
      </Panel>
      <Panel title="Events" meta={String(call.events.length)} flush>
        <Table
          columns={eventColumns}
          rows={call.events.map((event, position) => ({ ...event, position }))}
          rowKey={(event) => String(event.position)}
          caption="Protocol events"
        />
      </Panel>
      {call.droppedEvents > 0 && (
        <Text size="sm" tone="muted">
          {call.droppedEvents} later events were not kept.
        </Text>
      )}
      <SimJson value={call} label="Raw call JSON" open={false} />
    </Stack>
  </article>
);
