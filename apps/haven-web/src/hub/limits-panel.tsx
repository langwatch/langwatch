import {
  Badge,
  Button,
  Callout,
  Input,
  Inline,
  Panel,
  Stack,
  Text,
  useToast,
  type BadgeTone,
} from "@langwatch/design-system-internal";
import { useState } from "react";

import { LIMITS_PATH, getJson, limitPath, postAction } from "../shared/api.ts";
import { limitsSchema, type Limit, type Limits } from "../shared/contract.ts";
import { formatBytes } from "../shared/format.ts";
import { usePoll } from "../shared/use-poll.ts";

const POLL_MS = 10_000;

const SOURCE_TONES: Record<Limit["source"], BadgeTone> = {
  default: "neutral",
  settings: "brand",
  ".env": "warn",
  env: "warn",
};

const LimitRow = ({
  limit,
  busy,
  onSave,
  onReset,
}: {
  limit: Limit;
  busy: boolean;
  onSave: (input: { name: string; value: number }) => void;
  onReset: (input: { name: string }) => void;
}) => {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const shown = draft ?? String(limit.value);
  const parsed = Number(shown);
  const isValid = shown.trim() !== "" && Number.isInteger(parsed);
  return (
    <Stack gap={1}>
      <Inline gap={3} wrap>
        <Text weight="medium" mono>
          {limit.name}
        </Text>
        <Badge tone={SOURCE_TONES[limit.source]} title={limit.env}>
          {limit.source}
        </Badge>
      </Inline>
      <Inline gap={2} wrap>
        <Input
          label={limit.name}
          hideLabel
          size="sm"
          mono
          type="number"
          min={limit.allowZero ? 0 : limit.min}
          max={limit.max}
          value={shown}
          onChange={setDraft}
        />
        <Text tone="secondary">{limit.unit}</Text>
        <Button
          size="sm"
          variant="primary"
          loading={busy}
          disabled={!isValid || draft === undefined}
          onClick={() => {
            onSave({ name: limit.name, value: parsed });
            setDraft(undefined);
          }}
        >
          Save
        </Button>
        <Button
          size="sm"
          disabled={busy || limit.source !== "settings"}
          onClick={() => {
            onReset({ name: limit.name });
            setDraft(undefined);
          }}
        >
          Reset
        </Button>
        <Text size="sm" tone="muted">
          default {limit.default} {limit.unit}, {limit.allowZero ? "0 or " : ""}
          {limit.min} to {limit.max}
        </Text>
      </Inline>
      <Text size="sm" tone="secondary">
        Applies {limit.applies}
      </Text>
      {(limit.source === "env" || limit.source === ".env") && (
        <Text size="sm" tone="muted">
          {limit.env} is set in {limit.source}, which wins over a saved value.
        </Text>
      )}
    </Stack>
  );
};

/** The machine's resource limits: what applies, where it came from, and a way to change it. */
export const LimitsPanel = () => {
  const toast = useToast();
  const poll = usePoll({
    key: "limits",
    intervalMs: POLL_MS,
    load: ({ signal }): Promise<Limits> =>
      getJson({ path: LIMITS_PATH, schema: limitsSchema, signal }),
  });
  const [busy, setBusy] = useState<string | undefined>(undefined);

  const change = async ({
    name,
    doing,
    send,
  }: {
    name: string;
    doing: string;
    send: () => Promise<string>;
  }) => {
    setBusy(name);
    try {
      toast.show({ title: await send(), tone: "ok" });
      await poll.refresh();
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      toast.show({ title: `Could not ${doing}`, description, tone: "error" });
    } finally {
      setBusy(undefined);
    }
  };

  const limits = poll.data;
  return (
    <Panel
      title="Machine limits"
      meta={
        limits === undefined
          ? undefined
          : `${formatBytes({ bytes: limits.totalRamBytes })} RAM · ${limits.cpus} CPUs`
      }
    >
      {limits === undefined ? (
        poll.error !== undefined && (
          <Callout tone="error" title="Could not read the limits">
            {poll.error}
          </Callout>
        )
      ) : (
        <Stack gap={5}>
          {limits.limits.map((limit) => (
            <LimitRow
              key={`${limit.name}:${limit.value}:${limit.source}`}
              limit={limit}
              busy={busy === limit.name}
              onSave={({ name, value }) =>
                void change({
                  name,
                  doing: `save ${name}`,
                  send: () =>
                    postAction({ path: limitPath({ name }), method: "PUT", body: { value } }),
                })
              }
              onReset={({ name }) =>
                void change({
                  name,
                  doing: `reset ${name}`,
                  send: () => postAction({ path: limitPath({ name }), method: "DELETE" }),
                })
              }
            />
          ))}
        </Stack>
      )}
    </Panel>
  );
};
