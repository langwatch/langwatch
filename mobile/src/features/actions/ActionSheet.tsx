import { useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";

import { describeError } from "@/api/trpc";
import { type ActionSpec, isActionConfirmed } from "@/lib/actions";
import { Button, Row, Screen, Section } from "@/ui/primitives";
import { useTheme } from "@/ui/theme";

/**
 * What running an action produced. `summary` is the sentence the operator
 * reads — built from the counts the server returned, so the app reports what
 * happened rather than merely that something did.
 */
export interface ActionOutcome {
  summary: string;
}

export interface BoundAction {
  spec: ActionSpec;
  run: () => Promise<ActionOutcome>;
  /**
   * The blast radius, for actions the operator cannot size up from the row they
   * tapped. Plain data rather than a component: a component built inside the
   * caller's hook would be a new identity on every render, remounting itself and
   * re-firing whatever it reports.
   */
  preview?: ActionPreview;
}

export interface ActionPreview {
  loading: boolean;
  /** Nothing to act on — the sheet withholds the run button rather than
   * offering a confirmation that ends in a no-op. */
  empty: boolean;
  headline: string;
  /** Breakdown lines, e.g. per pipeline and per error. */
  lines: string[];
}

type Step =
  | { kind: "choosing" }
  | { kind: "confirming"; action: BoundAction }
  | { kind: "running"; action: BoundAction }
  | { kind: "done"; action: BoundAction; outcome: ActionOutcome }
  | { kind: "failed"; action: BoundAction; message: string };

/**
 * Choose → (preview) → confirm → run → result, in a sheet.
 *
 * The mobile counterpart of the web's row overflow menu (see
 * `dev/docs/best_practices/row-actions-overflow-menu.md` and
 * `mobile-row-actions.md`): one trigger per row, every action one deliberate
 * step from being run, and the destructive ones tinted and gated.
 *
 * The sheet does not close itself on success. An operator who has just drained a
 * queue needs to read what it did, and a sheet that vanishes takes the only
 * report of that with it.
 */
export function ActionSheet({
  title,
  subject,
  actions,
  visible,
  onClose,
}: {
  title: string;
  /** What is being acted on — the group id, queue name, project id. */
  subject: string;
  actions: BoundAction[];
  visible: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [step, setStep] = useState<Step>({ kind: "choosing" });
  const [typed, setTyped] = useState("");

  const close = () => {
    setStep({ kind: "choosing" });
    setTyped("");
    onClose();
  };

  const choose = (action: BoundAction) => {
    setTyped("");
    setStep({ kind: "confirming", action });
  };

  const run = async (action: BoundAction) => {
    setStep({ kind: "running", action });
    try {
      const outcome = await action.run();
      setStep({ kind: "done", action, outcome });
    } catch (error) {
      setStep({
        kind: "failed",
        action,
        message: describeError(error).message,
      });
    }
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
          <Section title={title} footer={subject}>
            {step.kind === "choosing" ? (
              actions.length === 0 ? (
                <Row last>
                  <Text style={{ color: theme.textMuted, fontSize: 13 }}>
                    Nothing to do here right now.
                  </Text>
                </Row>
              ) : (
                actions.map((action, index) => (
                  <Pressable
                    key={action.spec.id}
                    onPress={() => choose(action)}
                    accessibilityRole="button"
                  >
                    <Row last={index === actions.length - 1}>
                      <Text
                        style={{
                          color: action.spec.destructive
                            ? theme.critical
                            : theme.accent,
                          fontSize: 16,
                          fontWeight: "600",
                        }}
                      >
                        {action.spec.title}
                      </Text>
                    </Row>
                  </Pressable>
                ))
              )
            ) : (
              <Row last>
                <Text style={{ color: theme.text, fontSize: 16, fontWeight: "600" }}>
                  {step.action.spec.title}
                </Text>
              </Row>
            )}
          </Section>

          {step.kind === "confirming" ? (
            <>
              <Section>
                <Row last>
                  <Text
                    style={{ color: theme.textMuted, fontSize: 14, lineHeight: 20 }}
                  >
                    {step.action.spec.description}
                  </Text>
                </Row>
              </Section>

              {step.action.preview ? (
                <PreviewCard preview={step.action.preview} />
              ) : null}

              {step.action.preview?.loading ? null : step.action.preview?.empty ? (
                <Section>
                  <Row last>
                    <Text style={{ color: theme.textMuted, fontSize: 14 }}>
                      There is nothing for this to act on.
                    </Text>
                  </Row>
                </Section>
              ) : (
                <Section
                  footer={
                    step.action.spec.confirmWord
                      ? `Type ${step.action.spec.confirmWord} to enable this.`
                      : undefined
                  }
                >
                  {step.action.spec.confirmWord ? (
                    <Row>
                      <TextInput
                        value={typed}
                        onChangeText={setTyped}
                        placeholder={step.action.spec.confirmWord}
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
                  ) : null}
                  <Row last>
                    <Button
                      title={step.action.spec.title}
                      destructive={step.action.spec.destructive}
                      disabled={!isActionConfirmed(step.action.spec, typed)}
                      onPress={() => void run(step.action)}
                    />
                  </Row>
                </Section>
              )}
            </>
          ) : null}

          {step.kind === "running" ? (
            <Section>
              <Row last>
                <Button title="Working…" busy onPress={() => undefined} />
              </Row>
            </Section>
          ) : null}

          {step.kind === "done" ? (
            <Section title="Done">
              <Row last>
                <Text style={{ color: theme.text, fontSize: 14, lineHeight: 20 }}>
                  {step.outcome.summary}
                </Text>
              </Row>
            </Section>
          ) : null}

          {step.kind === "failed" ? (
            <Section title="That did not run">
              <Row last>
                <Text style={{ color: theme.warning, fontSize: 14, lineHeight: 20 }}>
                  {step.message}
                </Text>
              </Row>
            </Section>
          ) : null}

          <Section>
            {step.kind === "confirming" ? (
              <Row>
                <Button
                  title="Back"
                  onPress={() => setStep({ kind: "choosing" })}
                />
              </Row>
            ) : null}
            <Row last>
              <Button title={step.kind === "done" ? "Done" : "Close"} onPress={close} />
            </Row>
          </Section>
        </Screen>
      </View>
    </Modal>
  );
}

function PreviewCard({ preview }: { preview: ActionPreview }) {
  const theme = useTheme();
  return (
    <Section title="What this would affect">
      <Row last={preview.lines.length === 0}>
        <Text style={{ color: theme.text, fontSize: 15, fontWeight: "600" }}>
          {preview.loading ? "Working it out…" : preview.headline}
        </Text>
      </Row>
      {preview.lines.map((line, index) => (
        <Row key={line} last={index === preview.lines.length - 1}>
          <Text style={{ color: theme.textMuted, fontSize: 13 }}>{line}</Text>
        </Row>
      ))}
    </Section>
  );
}

/** The trailing "…" that opens the sheet. One per row, as on the web. */
export function ActionsTrigger({
  label,
  onPress,
}: {
  /** Names the row, so the control is not just "more options" to a screen reader. */
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Actions for ${label}`}
      hitSlop={10}
      style={{ paddingHorizontal: 6 }}
    >
      <Text style={{ color: theme.accent, fontSize: 20, lineHeight: 20 }}>⋯</Text>
    </Pressable>
  );
}
