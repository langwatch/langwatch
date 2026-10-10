import { Meter, Panel, Stack, Text } from "@langwatch/design-system-internal";

import { storeStatSchema, type StoreStat } from "../shared/contract.ts";
import { formatBytes } from "../shared/format.ts";
import { useCliRows } from "../shared/use-cli-rows.ts";

const amount = ({ value, unit }: { value: number; unit: string }) =>
  unit === "bytes" ? formatBytes({ bytes: value }) : `${value}`;

const StoreMeter = ({ stat }: { stat: StoreStat }) => {
  const used = amount({ value: stat.used, unit: stat.unit });
  const label = `${stat.name} ${stat.measure}`;
  if (stat.limit <= 0) return <Text>{`${label}: ${used}, no limit`}</Text>;
  return (
    <Meter
      label={label}
      value={stat.used}
      max={stat.limit}
      detail={`${used} of ${amount({ value: stat.limit, unit: stat.unit })}`}
    />
  );
};

/** `haven status`'s stores section: each managed database server against its limit. */
export const StoresPanel = ({ slug }: { slug: string }) => {
  const stores = useCliRows({ slug, name: "stores", row: storeStatSchema });
  const stats = stores.data ?? [];
  return (
    <Panel title="Stores">
      {stats.length === 0 ? (
        <Text tone="muted">{stores.error ?? "No store readings yet"}</Text>
      ) : (
        <Stack gap={3}>
          {stats.map((stat) => (
            <StoreMeter key={`${stat.name}:${stat.measure}`} stat={stat} />
          ))}
        </Stack>
      )}
    </Panel>
  );
};
