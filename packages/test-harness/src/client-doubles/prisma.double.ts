import { PrismaClient } from "@langwatch/prisma-client/generated";

import { type ClientScript, scriptedClient } from "./scripted-client.ts";

/** A PrismaClient answering only the delegates and methods the test scripted. */
export function prismaDouble(script: ClientScript<PrismaClient> = {}): PrismaClient {
  const client = new PrismaClient({
    adapter: {
      provider: "postgres",
      adapterName: "prisma-double",
      connect: () => Promise.reject(new Error("the Prisma double never connects")),
    },
  });
  return scriptedClient({ client, script, name: "prisma" });
}
