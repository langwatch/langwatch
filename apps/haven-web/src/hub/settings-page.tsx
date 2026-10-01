import { Callout, Page, Stack, useToast } from "@langwatch/design-system-internal";
import { useState } from "react";

import { LIMITS_PATH, getJson, limitPath, postAction } from "../shared/api.ts";
import { limitsSchema, type HubStack, type Limits } from "../shared/contract.ts";
import { formatBytes } from "../shared/format.ts";
import { HavenTopBar } from "../shared/haven-top-bar.tsx";
import { usePoll } from "../shared/use-poll.ts";
import { LimitsForm } from "./limits-form.tsx";
import { labelOf, type Change } from "./limits.ts";

const POLL_MS = 10_000;

/** A value back at its default clears the saved one; anything else is saved. */
const send = ({ limit, value }: Change) => {
  const path = limitPath({ name: limit.name });
  const clears = value === limit.default && limit.source === "settings";
  return clears
    ? postAction({ path, method: "DELETE" })
    : postAction({ path, method: "PUT", body: { value } });
};

const describe = ({ error }: { error: unknown }) =>
  error instanceof Error ? error.message : String(error);

type Outcome = { saved: string[]; failed: Map<string, string> };

/**
 * Sends each change; one the machine refuses (a container that outgrows the
 * VM until the VM grows too) gets one more try after the rest have landed.
 */
const sendAll = async ({ changes }: { changes: Change[] }): Promise<Outcome> => {
  const saved: string[] = [];
  let failed = new Map<string, string>();
  let pending = changes;
  for (let pass = 0; pass < 2 && pending.length > 0; pass += 1) {
    const retry: Change[] = [];
    failed = new Map();
    for (const change of pending) {
      try {
        await send(change);
        saved.push(change.limit.name);
      } catch (error) {
        retry.push(change);
        failed.set(labelOf({ limit: change.limit }), describe({ error }));
      }
    }
    pending = retry;
  }
  return { saved, failed };
};

/** The hub's Settings page: the machine's resource limits, saved together. */
export const SettingsPage = ({ hubStacks }: { hubStacks?: HubStack[] }) => {
  const toast = useToast();
  const poll = usePoll({
    key: "limits",
    intervalMs: POLL_MS,
    load: ({ signal }): Promise<Limits> =>
      getJson({ path: LIMITS_PATH, schema: limitsSchema, signal }),
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const limits = poll.data;

  const save = async ({ changes }: { changes: Change[] }) => {
    const { saved, failed } = await sendAll({ changes });
    setDrafts((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([name]) => !saved.includes(name))),
    );
    if (failed.size === 0) {
      toast.show({
        title: `Saved ${saved.length} ${saved.length === 1 ? "setting" : "settings"}`,
        tone: "ok",
      });
    } else {
      const [first] = [...failed];
      toast.show({
        title: `Could not save ${[...failed.keys()].join(", ")}`,
        description: first === undefined ? undefined : first[1],
        tone: "error",
      });
    }
    await poll.refresh();
  };

  return (
    <Page
      nav={<HavenTopBar current="settings" hubHref="/" stacks={hubStacks} />}
      title="Settings"
      subtitle={
        limits === undefined
          ? "Reading the machine's limits…"
          : `Limits for this machine: ${formatBytes({ bytes: limits.totalRamBytes })} RAM, ${limits.cpus} CPUs`
      }
    >
      {limits === undefined ? (
        poll.error !== undefined && (
          <Callout tone="error" title="Could not read the limits">
            {poll.error}
          </Callout>
        )
      ) : (
        <Stack gap={4}>
          <LimitsForm
            limits={limits.limits}
            drafts={drafts}
            onSave={({ changes: rowChanges }) => void save({ changes: rowChanges })}
            onDraft={({ name, text }) =>
              setDrafts((previous) => {
                const rest = Object.entries(previous).filter(([key]) => key !== name);
                return Object.fromEntries(text === undefined ? rest : [...rest, [name, text]]);
              })
            }
          />
        </Stack>
      )}
    </Page>
  );
};
