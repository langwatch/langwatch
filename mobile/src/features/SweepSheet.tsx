import { useState } from "react";
import { Modal, Text, TextInput, View } from "react-native";

import { trpc } from "@/api/trpc";
import { formatCount, formatMilliseconds } from "@/lib/format";
import { isSweepConfirmed, SWEEP_CONFIRMATION } from "@/lib/ops";
import {
  Button,
  Row,
  Screen,
  Section,
  StatTile,
  TileGrid,
} from "@/ui/primitives";
import { useTheme } from "@/ui/theme";

/**
 * Trial, then reclaim.
 *
 * The order is the design: the trial and the real sweep run the same code on the
 * server, so the tally an operator approves is the tally the sweep produced, not
 * an estimate arrived at some other way.
 */
export function SweepSheet({
  visible,
  onClose,
  onReclaimed,
}: {
  visible: boolean;
  onClose: () => void;
  onReclaimed: () => void;
}) {
  const theme = useTheme();
  const [confirmation, setConfirmation] = useState("");

  const sweep = trpc.ops.runBlobCleanup.useMutation();
  const report = sweep.data;
  const confirmed = isSweepConfirmed(confirmation);

  const close = () => {
    sweep.reset();
    setConfirmation("");
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
    >
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <Screen>
          <Section title="Cleanup sweep">
            <Row last>
              <Text style={{ color: theme.textMuted, fontSize: 13 }}>
                A trial walks the payload store and reports what a real sweep
                would reclaim, repair and leave pending. It deletes nothing.
              </Text>
            </Row>
          </Section>

          {report ? (
            <>
              <View>
                <TileGrid>
                  <StatTile
                    title={report.dryRun ? "Would reclaim" : "Reclaimed"}
                    value={formatCount(report.totals.reclaimed)}
                    caption="payloads"
                    severity={report.totals.reclaimed > 0 ? "warning" : "normal"}
                  />
                  <StatTile
                    title={report.dryRun ? "Would repair" : "Repaired"}
                    value={formatCount(report.totals.repaired)}
                    caption="expiry shortened"
                  />
                  <StatTile
                    title="Still leased"
                    value={formatCount(report.totals.leased)}
                    caption="left alone"
                  />
                  <StatTile
                    title="Examined"
                    value={formatCount(report.totals.scanned)}
                    caption={report.totals.truncated ? "ceiling reached" : "complete"}
                  />
                </TileGrid>
              </View>

              {report.queues.length > 0 ? (
                <Section
                  title="By queue"
                  footer={`Took ${formatMilliseconds(report.durationMs)}.`}
                >
                  {report.queues.map((queue, index) => (
                    <Row
                      key={queue.queueName}
                      last={index === report.queues.length - 1}
                    >
                      <View style={{ gap: 2 }}>
                        <Text
                          numberOfLines={1}
                          ellipsizeMode="middle"
                          style={{
                            color: theme.text,
                            fontFamily: "Menlo",
                            fontSize: 12,
                          }}
                        >
                          {queue.queueName}
                        </Text>
                        <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                          {`${queue.reclaimed} reclaimed · ${queue.repaired} repaired · ${queue.pending} pending · ${queue.leased} leased`}
                        </Text>
                      </View>
                    </Row>
                  ))}
                </Section>
              ) : null}
            </>
          ) : null}

          {sweep.error ? (
            <Section title="Sweep failed">
              <Row last>
                <Text style={{ color: theme.warning, fontSize: 13 }}>
                  {sweep.error.message}
                </Text>
              </Row>
            </Section>
          ) : null}

          {report?.dryRun &&
          (report.totals.reclaimed > 0 || report.totals.repaired > 0) ? (
            <Section
              title="Reclaim for real"
              footer={`This deletes the payload bytes and cannot be undone. Type ${SWEEP_CONFIRMATION} to enable it.`}
            >
              <Row>
                <TextInput
                  value={confirmation}
                  onChangeText={setConfirmation}
                  placeholder={SWEEP_CONFIRMATION}
                  placeholderTextColor={theme.textMuted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={{
                    color: theme.text,
                    fontFamily: "Menlo",
                    fontSize: 16,
                    paddingVertical: 4,
                  }}
                />
              </Row>
              <Row last>
                <Button
                  title={`Reclaim ${formatCount(report.totals.reclaimed)} payloads`}
                  destructive
                  disabled={!confirmed}
                  busy={sweep.isLoading}
                  onPress={() => {
                    sweep.mutate(
                      { dryRun: false, confirm: SWEEP_CONFIRMATION },
                      { onSuccess: onReclaimed },
                    );
                    setConfirmation("");
                  }}
                />
              </Row>
            </Section>
          ) : (
            <Section>
              <Row last>
                <Button
                  title={report ? "Run another trial" : "Run a trial"}
                  busy={sweep.isLoading}
                  onPress={() => sweep.mutate({ dryRun: true })}
                />
              </Row>
            </Section>
          )}

          <Section>
            <Row last>
              <Button title="Done" onPress={close} />
            </Row>
          </Section>
        </Screen>
      </View>
    </Modal>
  );
}
