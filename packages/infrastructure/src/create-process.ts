/**
 * One statement for what a process is: its role, the config it parsed, and the
 * members it hands its modules.
 *
 * ```ts
 * await createProcess({ role: "api", config }).withModules(serverModules).boot();
 * await createProcess({ role: "api", config, members: { clock: frozenAt(...) } })
 *   .withModules([...]).boot();
 * ```
 *
 * A root that reads this way has nowhere to build a second client: the members
 * come from `createProcessMembers`, which builds each exactly once, in order,
 * and closes them in reverse. A member the caller passes is used as it stands;
 * a member handed in as an own property whose value is `undefined` is a boot
 * refusal naming it, because `exactOptionalPropertyTypes` is off and a
 * misspelt override would otherwise become the real client.
 */
import { createApp, type ApplicationBuilder, type ServerRole } from "@langwatch/runtime-composition";
import { createProcessMembers } from "./create-members.ts";
import type { ProcessConfig } from "./config.ts";
import type { MemberName, ProcessMembers } from "./members.ts";

/** What a process states about itself before a single module is installed. */
export interface ProcessOptions {
  /** Which of the three processes this is. */
  readonly role: ServerRole;
  /** What this process parsed about itself: the datastores, mail, the keys. */
  readonly config: ProcessConfig;
  /**
   * One slice per module name, for the modules that declared a config schema.
   * Absent hands every module `undefined`, which each module's own schema then
   * accepts or refuses by name.
   */
  readonly moduleConfig?: Readonly<Record<string, unknown>>;
  /**
   * Members this caller built itself. One passed is used as it stands and is
   * never closed by this process, because whoever made it owns it.
   */
  readonly members?: { readonly [Name in MemberName]?: ProcessMembers[Name] };
}

/** The process, ready to be told which modules it installs. Nothing is built yet. */
export function createProcess(options: ProcessOptions): ApplicationBuilder<ProcessMembers> {
  const members = createProcessMembers({ config: options.config, members: options.members });
  return createApp<ProcessMembers>({
    role: options.role,
    ...(options.moduleConfig ? { config: options.moduleConfig } : {}),
    members,
  });
}
