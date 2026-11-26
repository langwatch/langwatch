import type { PiiDetectionOutcome, PiiDetectionRequest } from "@langwatch/evaluation-contract";
import { formatPiiMarker } from "@langwatch/redaction";

import type { PresidioChannel } from "../../channels/presidio.channel.ts";

/** A value the fake model finds wherever it appears in the content it is sent. */
export type PlantedValue = Readonly<{ value: string; entity: string; score: number }>;

/** Python's `str.isspace` set, which the model trims with (saas `domain/pyunicode`). */
const PYTHON_WHITESPACE: readonly (readonly [number, number])[] = [
  [0x09, 0x0d],
  [0x1c, 0x20],
  [0x85, 0x85],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
];

export function isPythonSpace(char: string | undefined): boolean {
  const code = char?.codePointAt(0);
  return code !== undefined && PYTHON_WHITESPACE.some(([low, high]) => code >= low && code <= high);
}

function pythonStrip(text: string): string {
  const chars = Array.from(text);
  let start = 0;
  let end = chars.length;
  while (start < end && isPythonSpace(chars[start])) start++;
  while (end > start && isPythonSpace(chars[end - 1])) end--;
  return chars.slice(start, end).join("");
}

/** The model's `json.loads` check, bare NaN and Infinity included (saas `pyJSONValid`). */
function isPythonJson(text: string): boolean {
  try {
    // Bare NaN and Infinity outside strings read as null, as the model's parser accepts them.
    JSON.parse(
      text.replace(/"(?:\\.|[^"\\])*"|(-?Infinity|NaN)/g, (whole, bare?: string) =>
        bare ? "null" : whole,
      ),
    );
    return true;
  } catch {
    return false;
  }
}

const unfold = (text: string) =>
  text.replaceAll("\\n", "\n").replaceAll("\\t", "\t").replaceAll("\\r", "\r");
const fold = (text: string) =>
  text.replaceAll("\n", "\\n").replaceAll("\t", "\\t").replaceAll("\r", "\\r");

type Finding = { entity_type: string; start: number; end: number; score: number };

/** Every planted value in `content`, in code points of `content`, as the model reports them. */
function findingsIn(content: string, planted: readonly PlantedValue[]): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const { value, entity, score } of planted) {
    let from = content.indexOf(value);
    while (from >= 0) {
      const start = Array.from(content.slice(0, from)).length;
      const finding = { entity_type: entity, start, end: start + Array.from(value).length, score };
      const key = `${finding.entity_type}:${finding.start}:${finding.end}`;
      if (!seen.has(key)) findings.push(finding);
      seen.add(key);
      from = content.indexOf(value, from + 1);
    }
  }
  return findings.toSorted((a, b) => a.start - b.start || b.end - a.end);
}

/** The model's own masked text: overlaps merged, the higher score's label, `<ENTITY>`. */
function anonymize(content: string, findings: readonly Finding[]): string {
  const chars = Array.from(content);
  const merged: Finding[] = [];
  for (const finding of findings.toSorted((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (!last || finding.start >= last.end) {
      merged.push({ ...finding });
      continue;
    }
    merged[merged.length - 1] = {
      ...(finding.score > last.score ? finding : last),
      start: last.start,
      end: Math.max(last.end, finding.end),
    };
  }
  let out = "";
  let cursor = 0;
  for (const { entity_type, start, end } of merged) {
    out += chars.slice(cursor, start).join("") + `<${entity_type}>`;
    cursor = end;
  }
  return out + chars.slice(cursor).join("");
}

/** How the fake meets one call: answers, fails, holds until released, or answers after `slowMs`. */
export type FakeTurn = "answer" | "fail" | "throttle" | "hold" | "lie" | { slowMs: number };

type HeldCall = { release: () => void; throttle: () => void };

/**
 * A stand-in for the PII redaction model that prepares each text as its Presidio route does
 * (Python strip, JSON unfold), finds the planted values, and answers with code point offsets
 * and its own masked text, folded back for JSON. `lie` shifts every offset by one.
 */
export function fakePiiModel({
  planted,
  turns = [],
}: {
  planted: readonly PlantedValue[];
  turns?: FakeTurn[];
}) {
  const calls: string[][] = [];
  const held: HeldCall[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const answer = (texts: readonly string[], lie: boolean): PiiDetectionOutcome => ({
    kind: "detected",
    results: texts.map((text) => {
      const stripped = pythonStrip(text);
      const json = isPythonJson(stripped);
      const content = json ? unfold(stripped) : stripped;
      const findings = findingsIn(content, planted).map((finding) =>
        lie ? { ...finding, start: finding.start + 1, end: finding.end + 1 } : finding,
      );
      const masked = anonymize(content, findingsIn(content, planted));
      return {
        status: "processed" as const,
        raw_response: { results: findings, anonymized: json ? fold(masked) : masked },
      };
    }),
  });

  const channel: PresidioChannel = {
    detect: (input: PiiDetectionRequest) => {
      if (input.texts.length === 0) return Promise.resolve({ kind: "detected", results: [] });
      calls.push([...input.texts]);
      const turn = turns.shift() ?? "answer";
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      let settled = false;
      const settle = <T>(value: T) => {
        if (!settled) inFlight--;
        settled = true;
        return value;
      };
      if (turn === "fail") return Promise.reject(settle(new Error("model refused")));
      if (turn === "throttle") {
        const throttled = new Error("Rate exceeded");
        throttled.name = "TooManyRequestsException";
        return Promise.reject(settle(throttled));
      }
      if (turn === "answer" || turn === "lie") {
        return Promise.resolve(settle(answer(input.texts, turn === "lie")));
      }
      return new Promise<PiiDetectionOutcome>((resolve, reject) => {
        const onAbort = () => {
          const aborted = new Error("Request aborted");
          aborted.name = "AbortError";
          if (!settled) reject(settle(aborted));
        };
        const finish = () => {
          input.signal.removeEventListener("abort", onAbort);
          if (!settled) resolve(settle(answer(input.texts, false)));
        };
        const throttle = () => {
          input.signal.removeEventListener("abort", onAbort);
          const throttled = new Error("Rate exceeded");
          throttled.name = "TooManyRequestsException";
          if (!settled) reject(settle(throttled));
        };
        input.signal.addEventListener("abort", onAbort);
        if (typeof turn === "object") setTimeout(finish, turn.slowMs);
        else held.push({ release: finish, throttle });
      });
    },
  };

  return {
    channel,
    calls,
    held,
    inFlight: () => inFlight,
    maxInFlight: () => maxInFlight,
  };
}

/** A text built from plain runs and planted values, with the text the model path must produce. */
export function plantedText(parts: readonly (string | { pii: string; entity: string })[]) {
  let text = "";
  let expected = "";
  const planted: PlantedValue[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      text += part;
      expected += part;
      continue;
    }
    text += part.pii;
    expected += formatPiiMarker(part.entity);
    planted.push({ value: part.pii, entity: part.entity, score: 0.9 });
  }
  return { text, expected, planted };
}

/** Numbered plain words up to exactly `length` characters: no two runs alike, no planted value. */
export function filler(length: number, firstWord = 0): string {
  let text = "";
  for (let word = firstWord; text.length < length; word++) text += `w${word.toString(36)} `;
  return text.slice(0, length);
}
