/**
 * The target the journey's HTTP agent talks to. A run has to complete, so the address the agent
 * names must answer.
 */
import { createServer, type Server } from "node:http";

export const ECHO_AGENT_REPLY =
  "Thank you for reaching out. I have cancelled the charge and refunded you in full.";

export type EchoAgent = Readonly<{
  url: string;
  stop: () => Promise<void>;
}>;

export async function startEchoAgent(): Promise<EchoAgent> {
  const server: Server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          output: ECHO_AGENT_REPLY,
          choices: [{ message: { role: "assistant", content: ECHO_AGENT_REPLY } }],
        }),
      );
    });
  });

  await new Promise<void>((ready, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", ready);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the echo agent did not bind a loopback port");
  }

  return {
    url: `http://127.0.0.1:${address.port}/agent`,
    stop: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
