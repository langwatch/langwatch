import { type ReactNode, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { describeError } from "@/api/trpc";
import type { Severity } from "@/lib/ops";
import { severityColor, useTheme } from "./theme";

/** A scrollable screen body with pull-to-refresh. */
export function Screen({
  children,
  onRefresh,
  refreshing = false,
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.screenContent}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

export function Section({
  title,
  footer,
  children,
}: {
  title?: string;
  footer?: string;
  /** Optional, so a section can be a standalone note with no rows. */
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      {title ? (
        <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>
          {title.toUpperCase()}
        </Text>
      ) : null}
      {children ? (
        <View
          style={[
            styles.card,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          {children}
        </View>
      ) : null}
      {footer ? (
        <Text style={[styles.sectionFooter, { color: theme.textMuted }]}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

export function Row({
  children,
  onPress,
  last = false,
}: {
  children: ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const theme = useTheme();
  const body = (
    <View
      style={[
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
      ]}
    >
      {children}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}
      accessibilityRole="button"
    >
      {body}
    </Pressable>
  );
}

/** A "key: value" line, which detail screens are mostly made of. */
export function DetailRow({
  label,
  value,
  mono = false,
  last = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  last?: boolean;
}) {
  const theme = useTheme();
  return (
    <Row last={last}>
      <View style={styles.detailRow}>
        <Text style={[styles.detailLabel, { color: theme.textMuted }]}>{label}</Text>
        <Text
          selectable
          style={[
            styles.detailValue,
            { color: theme.text },
            mono && styles.mono,
          ]}
        >
          {value}
        </Text>
      </View>
    </Row>
  );
}

export function StatTile({
  title,
  value,
  caption,
  severity = "normal",
}: {
  title: string;
  value: string;
  caption?: string;
  severity?: Severity;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.tile,
        { backgroundColor: theme.card, borderColor: theme.border },
      ]}
      accessibilityLabel={[title, value, caption].filter(Boolean).join(", ")}
    >
      <Text style={[styles.tileTitle, { color: theme.textMuted }]} numberOfLines={1}>
        {title}
      </Text>
      <Text
        style={[styles.tileValue, { color: severityColor(theme, severity) }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {caption ? (
        <Text style={[styles.tileCaption, { color: theme.textMuted }]} numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Two across, not adaptive: three tiles on a phone makes every number truncate,
 * and these numbers are the point of the screen.
 */
export function TileGrid({ children }: { children: ReactNode }) {
  return <View style={styles.tileGrid}>{children}</View>;
}

export function Pill({
  text,
  severity = "normal",
}: {
  text: string;
  severity?: Severity;
}) {
  const theme = useTheme();
  const color = severityColor(theme, severity);
  return (
    <View style={[styles.pill, { backgroundColor: color + "22" }]}>
      <Text style={[styles.pillText, { color }]}>{text}</Text>
    </View>
  );
}

export function EmptyRow({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <Row last>
      <Text style={[styles.empty, { color: theme.textMuted }]}>{message}</Text>
    </Row>
  );
}

/**
 * Renders a query's four states so no screen reinvents them.
 *
 * The failure branch distinguishes a retryable problem from a terminal one: a
 * network blip gets a retry button, "this account has no ops access" does not,
 * because a button that cannot help is worse than none.
 */
export function QueryState<T>({
  query,
  children,
}: {
  query: {
    data: T | undefined;
    isLoading: boolean;
    error: unknown;
    refetch: () => void;
  };
  children: (data: T) => ReactNode;
}) {
  const theme = useTheme();

  if (query.data !== undefined) return <>{children(query.data)}</>;

  if (query.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (query.error) {
    const described = describeError(query.error);
    return (
      <View style={styles.centered}>
        <Text style={[styles.errorTitle, { color: theme.text }]}>
          {described.title}
        </Text>
        <Text style={[styles.errorMessage, { color: theme.textMuted }]}>
          {described.message}
        </Text>
        {described.retryable ? (
          <Pressable
            onPress={() => query.refetch()}
            accessibilityRole="button"
            style={[styles.button, { borderColor: theme.border }]}
          >
            <Text style={{ color: theme.accent }}>Try again</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return null;
}

/** A row that reveals detail in place — cheaper than a route for a leaf view. */
export function ExpandableRow({
  summary,
  detail,
  last = false,
}: {
  summary: ReactNode;
  detail: ReactNode;
  last?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Row onPress={() => setOpen((value) => !value)} last={last}>
      <View style={styles.expandable}>
        {summary}
        {open ? <View style={styles.expandableDetail}>{detail}</View> : null}
      </View>
    </Row>
  );
}

export function Button({
  title,
  onPress,
  disabled = false,
  destructive = false,
  busy = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  busy?: boolean;
}) {
  const theme = useTheme();
  const color = destructive ? theme.critical : theme.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy }}
      style={[
        styles.button,
        { borderColor: theme.border, opacity: disabled || busy ? 0.4 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator size="small" /> : null}
      <Text style={{ color, fontWeight: "600" }}>{title}</Text>
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  screenContent: { padding: 16, paddingBottom: 48, gap: 20 },
  section: { gap: 6 },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, marginLeft: 4 },
  sectionFooter: { fontSize: 12, marginHorizontal: 4, lineHeight: 16 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { paddingHorizontal: 14, paddingVertical: 11 },
  detailRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  detailLabel: { fontSize: 14, flexShrink: 0 },
  detailValue: { fontSize: 14, flex: 1, textAlign: "right" },
  mono: { fontFamily: "Menlo", fontSize: 12 },
  tileGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: {
    flexGrow: 1,
    flexBasis: "45%",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 2,
  },
  tileTitle: { fontSize: 11 },
  tileValue: { fontSize: 20, fontWeight: "700" },
  tileCaption: { fontSize: 11 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: "700" },
  empty: { fontSize: 14, textAlign: "center", paddingVertical: 8 },
  centered: { alignItems: "center", gap: 8, paddingVertical: 40 },
  errorTitle: { fontSize: 16, fontWeight: "600" },
  errorMessage: { fontSize: 13, textAlign: "center", paddingHorizontal: 24 },
  button: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  expandable: { gap: 8 },
  expandableDetail: { gap: 6 },
});
