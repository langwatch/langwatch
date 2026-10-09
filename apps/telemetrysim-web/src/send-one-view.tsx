import {
  Button,
  Checkbox,
  Inline,
  Input,
  Panel,
  Section,
  SegmentedControl,
  Select,
  Stack,
  Textarea,
} from "@langwatch/design-system-internal";
import { SimRefusal } from "@langwatch/sim-console";
import { useState, type FormEvent } from "react";

import { SendOneAnswerPanel } from "./send-one-answer.tsx";
import {
  encodings,
  sendOne,
  type Encoding,
  type SendOneAnswer,
  type SendOneRequest,
} from "./telemetry-api.ts";
import type { ViewProps } from "./view-props.ts";

type Source = "preset" | "body";

const sources: { value: Source; label: string }[] = [
  { value: "preset", label: "Preset" },
  { value: "body", label: "Pasted OTLP JSON" },
];

const encodingOptions = encodings.map((encoding) => ({ value: encoding, label: encoding }));

const isEncoding = (value: string): value is Encoding =>
  encodings.some((encoding) => encoding === value);

/** Posts one OTLP trace, log or metric request outside any run; shows the door's answer. */
export const SendOneView = ({ status }: ViewProps) => {
  const presets = status?.presets ?? [];
  const [source, setSource] = useState<Source>("preset");
  const [preset, setPreset] = useState("");
  const [seed, setSeed] = useState("1");
  const [encoding, setEncoding] = useState<Encoding>("protobuf");
  const [gzip, setGzip] = useState(true);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState("");
  const [answer, setAnswer] = useState<SendOneAnswer>();
  const chosen = preset || presets[0] || "";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const request: SendOneRequest =
      source === "body"
        ? { body, encoding, noGzip: !gzip }
        : { preset: chosen, seed: Number(seed), encoding, noGzip: !gzip };
    setBusy(true);
    setRefusal("");
    try {
      setAnswer(await sendOne({ request }));
    } catch (caught) {
      setRefusal(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Send one"
      description="One OTLP request at the stack's door, with no retry and no run: see exactly what it answers, a 415, a 429 with its Retry-After, or a 200."
    >
      <Stack gap={4}>
        <Panel title="Request">
          <form onSubmit={(event) => void submit(event)}>
            <Stack gap={3}>
              <SegmentedControl
                label="What to send"
                options={sources}
                value={source}
                onChange={setSource}
              />
              <Inline gap={3} wrap>
                {source === "preset" && (
                  <>
                    <Select
                      label="Preset"
                      options={presets.map((name) => ({ value: name, label: name }))}
                      value={chosen}
                      onChange={setPreset}
                    />
                    <Input label="Seed" type="number" min={0} value={seed} onChange={setSeed} />
                  </>
                )}
                <Select
                  label="Encoding"
                  options={encodingOptions}
                  value={encoding}
                  onChange={(value) => isEncoding(value) && setEncoding(value)}
                />
              </Inline>
              <Checkbox label="Gzip the body" checked={gzip} onChange={setGzip} />
              {source === "body" && (
                <Textarea
                  label="OTLP JSON export request"
                  hint="resourceSpans, resourceLogs or resourceMetrics; protobuf converts it first."
                  mono
                  rows={10}
                  value={body}
                  onChange={setBody}
                />
              )}
              <Inline gap={3}>
                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  disabled={source === "body" ? body.trim() === "" : chosen === ""}
                >
                  Send
                </Button>
              </Inline>
              {refusal !== "" && <SimRefusal message={refusal} />}
            </Stack>
          </form>
        </Panel>
        {answer && <SendOneAnswerPanel answer={answer} />}
      </Stack>
    </Section>
  );
};
