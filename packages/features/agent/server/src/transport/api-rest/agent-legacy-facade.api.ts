import type { AgentApp } from "#app/agent.app";

type Forward<Name extends keyof AgentApp> = (
  input: Parameters<AgentApp[Name]>[0],
) => ReturnType<AgentApp[Name]>;

/**
 * The legacy REST vocabulary over the feature's application: it renames
 * `getById` to the `get` the deprecated surface has always published, so the
 * wire names a deployed caller depends on are not the application's own.
 */
export type LegacyAgentsRestApi = Readonly<{
  list: Forward<"list">;
  create: Forward<"create">;
  get: Forward<"getById">;
  update: Forward<"update">;
  archive: Forward<"archive">;
}>;

export const LegacyAgentsRestApi = {
  create(app: AgentApp): LegacyAgentsRestApi {
    return {
      list: (input) => app.list(input),
      create: (input) => app.create(input),
      get: (input) => app.getById(input),
      update: (input) => app.update(input),
      archive: (input) => app.archive(input),
    };
  },
};
