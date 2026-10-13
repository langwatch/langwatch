import { type AgentInput, AgentRole } from "@langwatch/scenario";

import { SerializedAgentChannel } from "../serialized-agent.channel.ts";

type ScriptedInput = Pick<AgentInput, "threadId" | "messages" | "newMessages">;
type ScriptedTurn = Readonly<{ reply: string; session?: unknown }>;

/** The agent under test, scripted: records every turn; an empty script refuses by name. */
export class MemorySerializedAgentChannel extends SerializedAgentChannel {
  static create(): MemorySerializedAgentChannel {
    return new MemorySerializedAgentChannel();
  }

  role = AgentRole.AGENT;
  readonly turns: ScriptedInput[] = [];
  readonly #script: ScriptedTurn[] = [];

  private constructor() {
    super();
    this.name = "MemorySerializedAgentChannel";
  }

  answerWith(turn: ScriptedTurn): void {
    this.#script.push(turn);
  }

  heldSession(threadId: string): unknown {
    return this.sessionOf(threadId);
  }

  async call(input: ScriptedInput): Promise<string> {
    this.turns.push(input);
    const turn = this.#script.shift();
    if (!turn) throw new Error("no scripted agent reply");
    this.storeSession({ threadId: input.threadId, session: turn.session });
    return turn.reply;
  }
}
