export interface TaskPrismaConnection {
  closeOnce(): Promise<void>;
}

export interface StandaloneTaskPrismaLifecycle<Connection extends TaskPrismaConnection> {
  compose(): Connection;
  configure(connection: Connection): void;
  execute(connection: Connection): Promise<void>;
  closeApp(): Promise<void>;
  closePrisma(): Promise<void>;
  reportCloseError(input: { target: "app" | "prisma"; error: unknown }): void;
}

/** Owns the standalone executable's Prisma lifecycle without constructing an App. */
export async function runStandaloneTaskWithPrisma<Connection extends TaskPrismaConnection>(
  lifecycle: StandaloneTaskPrismaLifecycle<Connection>,
): Promise<void> {
  let connection: Connection | undefined;
  let configured = false;

  try {
    connection = lifecycle.compose();
    lifecycle.configure(connection);
    configured = true;
    await lifecycle.execute(connection);
  } finally {
    try {
      await lifecycle.closeApp();
    } catch (error) {
      lifecycle.reportCloseError({ target: "app", error });
    }
    try {
      if (configured) {
        await lifecycle.closePrisma();
      } else {
        await connection?.closeOnce();
      }
    } catch (error) {
      lifecycle.reportCloseError({ target: "prisma", error });
    }
  }
}
