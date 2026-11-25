import {
  Button,
  Inline,
  Input,
  Panel,
  SegmentedControl,
  Stack,
  Table,
  Text,
  useToast,
  type TableColumn,
} from "@langwatch/design-system-internal";
import { useState } from "react";

import { MACHINE_SETTINGS_PATH, getJson, machineSettingPath, postAction } from "../shared/api.ts";
import {
  machineSettingsSchema,
  type MachineSetting,
  type MachineSettings,
} from "../shared/contract.ts";
import { usePoll } from "../shared/use-poll.ts";

const POLL_MS = 10_000;

const LABELS: Record<string, string> = {
  observability: "Observability stack",
  vm: "Colima VM (off: native only)",
  "runtime-auto-stop": "Stop the VM when idle",
  "runtime-idle-grace-minutes": "Idle grace before the VM stops",
};

const SWITCH_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
];

const labelOf = ({ setting }: { setting: MachineSetting }) => LABELS[setting.name] ?? setting.name;

const isMinutes = ({ text }: { text: string }) =>
  /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= 1440;

const ValueCell = ({
  setting,
  onSave,
}: {
  setting: MachineSetting;
  onSave: (input: { setting: MachineSetting; value: string }) => void;
}) => {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const label = labelOf({ setting });
  if (setting.kind === "switch") {
    return (
      <SegmentedControl
        size="sm"
        label={label}
        options={SWITCH_OPTIONS}
        value={setting.value}
        onChange={(next) => {
          if (next !== setting.value) onSave({ setting, value: next });
        }}
      />
    );
  }
  const shown = draft ?? setting.value;
  const valid = isMinutes({ text: shown });
  return (
    <Inline gap={2} align="start">
      <div className="haven-unit-field">
        <Input
          label={label}
          hideLabel
          size="sm"
          mono
          type="number"
          min={1}
          max={1440}
          value={shown}
          error={valid ? undefined : "Use 1–1440"}
          onChange={setDraft}
        />
        <span className="haven-unit-field-unit">min</span>
      </div>
      {draft !== undefined && valid && draft !== setting.value && (
        <Button
          size="sm"
          onClick={() => {
            setDraft(undefined);
            onSave({ setting, value: draft });
          }}
        >
          Save
        </Button>
      )}
    </Inline>
  );
};

/** The machine switches: observability on or off, and the idle VM auto-stop. */
export const MachineSettingsPanel = () => {
  const toast = useToast();
  const poll = usePoll({
    key: "machine-settings",
    intervalMs: POLL_MS,
    load: ({ signal }): Promise<MachineSettings> =>
      getJson({ path: MACHINE_SETTINGS_PATH, schema: machineSettingsSchema, signal }),
  });

  const save = async ({ setting, value }: { setting: MachineSetting; value: string }) => {
    try {
      const message = await postAction({
        path: machineSettingPath({ name: setting.name }),
        method: "PUT",
        body: { value },
      });
      toast.show({ title: `Saved ${labelOf({ setting })}`, description: message, tone: "ok" });
    } catch (error) {
      toast.show({
        title: `Could not save ${labelOf({ setting })}`,
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    }
    await poll.refresh();
  };

  const columns: TableColumn<MachineSetting>[] = [
    {
      key: "setting",
      header: "Setting",
      cell: (setting) => (
        <>
          <Text as="div" weight="medium">
            {labelOf({ setting })}
          </Text>
          <Text as="div" size="xs" tone="muted">
            {setting.summary}
          </Text>
        </>
      ),
    },
    {
      key: "value",
      header: "Value",
      width: "300px",
      cell: (setting) => (
        <Stack gap={1}>
          <ValueCell setting={setting} onSave={(input) => void save(input)} />
          <Text as="div" size="xs" tone="muted">
            default {setting.default}
          </Text>
        </Stack>
      ),
    },
  ];

  if (poll.data === undefined) return null;
  return (
    <Panel title="Machine">
      <Table
        columns={columns}
        rows={poll.data.settings}
        rowKey={(setting) => setting.name}
        caption="Machine settings"
      />
    </Panel>
  );
};
