import {
  httpAgentConfigSchema,
  httpAgentConfigStoringSecrets,
  type HttpAgentConfig,
} from "@langwatch/agent-contract";

/** Whether the config holds a credential that is not a `{{ secrets.NAME }}` reference. */
export async function holdsLiteralCredential(config: HttpAgentConfig): Promise<boolean> {
  let found = false;
  await httpAgentConfigStoringSecrets({
    config,
    owner: "probe",
    reference: async ({ value }) => {
      found = true;
      return value;
    },
  });
  return found;
}

/** Whether a version may copy this row: a typed-in HTTP credential never reaches a version. */
export async function versionMayCopy(row: { type: string; config: unknown }): Promise<boolean> {
  if (row.type === "connected") return false;
  if (row.type !== "http") return true;
  const parsed = httpAgentConfigSchema.safeParse(row.config);
  if (!parsed.success) return false;
  return !(await holdsLiteralCredential(parsed.data));
}
