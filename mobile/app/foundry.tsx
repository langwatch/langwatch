import { Stack } from "expo-router";
import { Text, View } from "react-native";

import { trpc } from "@/api/trpc";
import { formatMilliseconds } from "@/lib/format";
import {
  EmptyRow,
  ExpandableRow,
  QueryState,
  Screen,
  Section,
} from "@/ui/primitives";
import { useTheme } from "@/ui/theme";

/**
 * The Foundry, as a catalog.
 *
 * On the web the Foundry is a workbench: it builds a synthetic trace and emits it
 * into a project. Emitting telemetry from a phone into a live project is not
 * something anyone wants to do by accident on a train, so here it is read-only —
 * the presets and the span trees they would produce, and nothing that sends.
 */
export default function FoundryScreen() {
  const theme = useTheme();
  const presets = trpc.ops.listFoundryPresets.useQuery();

  return (
    <>
      <Stack.Screen options={{ title: "The Foundry" }} />
      <Screen
        onRefresh={() => void presets.refetch()}
        refreshing={presets.isRefetching}
      >
        <Section
          title="Presets"
          footer="Generating a trace from a preset happens in the web console."
        >
          <QueryState query={presets}>
            {({ presets: list }) =>
              list.length === 0 ? (
                <EmptyRow message="No presets are registered." />
              ) : (
                <>
                  {list.map((preset, index) => (
                    <ExpandableRow
                      key={preset.id}
                      last={index === list.length - 1}
                      summary={
                        <View style={{ gap: 3 }}>
                          <Text
                            style={{
                              color: theme.text,
                              fontSize: 15,
                              fontWeight: "600",
                            }}
                          >
                            {preset.name}
                          </Text>
                          <Text
                            numberOfLines={2}
                            style={{ color: theme.textMuted, fontSize: 12 }}
                          >
                            {preset.description}
                          </Text>
                          <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                            {`${preset.spanCount} spans`}
                            {preset.serviceName ? ` · ${preset.serviceName}` : ""}
                          </Text>
                        </View>
                      }
                      detail={
                        <View style={{ gap: 3 }}>
                          {flattenSpans(preset.spans).map((entry) => (
                            <Text
                              key={entry.path}
                              accessibilityLabel={`Depth ${entry.depth + 1}, ${
                                entry.name
                              }, ${entry.type}`}
                              style={{
                                color:
                                  entry.status === "error"
                                    ? theme.critical
                                    : theme.textMuted,
                                fontFamily: "Menlo",
                                fontSize: 11,
                                marginLeft: entry.depth * 12,
                              }}
                            >
                              {`${entry.name}  ${entry.type}`}
                              {entry.model ? `  ${entry.model}` : ""}
                              {`  ${formatMilliseconds(entry.durationMs)}`}
                            </Text>
                          ))}
                        </View>
                      }
                    />
                  ))}
                </>
              )
            }
          </QueryState>
        </Section>
      </Screen>
    </>
  );
}

interface FoundrySpan {
  name: string;
  type: string;
  durationMs: number;
  status: string;
  model: string | null;
  children: FoundrySpan[];
}

interface FlatSpan extends FoundrySpan {
  /** Position in the tree. Sibling spans can share a name, so identity has to
   * come from where a span sits rather than what it is called. */
  path: string;
  depth: number;
}

function flattenSpans(
  spans: readonly FoundrySpan[],
  depth = 0,
  prefix = "",
): FlatSpan[] {
  const flattened: FlatSpan[] = [];
  spans.forEach((span, index) => {
    const path = prefix ? `${prefix}.${index}` : String(index);
    flattened.push({ ...span, path, depth });
    flattened.push(...flattenSpans(span.children, depth + 1, path));
  });
  return flattened;
}
