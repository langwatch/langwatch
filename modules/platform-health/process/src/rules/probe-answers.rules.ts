/**
 * A project-keyed probe's answer: a JSON body at a status. `noStore` marks an answer no cache may
 * keep, because a monitor must see each canary run's real result. The door writes the response.
 */
export type ProjectKeyedProbeAnswer = Readonly<{ status: number; body: unknown; noStore: boolean }>;

/**
 * The Langy probe's answer: `dark` when the surface is off for the caller (the door answers what an
 * unmounted path would), else the canary's JSON body at its status. The door writes the response.
 */
export type LangyProbeAnswer =
  | Readonly<{ kind: "dark" }>
  | Readonly<{ kind: "canary"; status: number; body: unknown }>;
