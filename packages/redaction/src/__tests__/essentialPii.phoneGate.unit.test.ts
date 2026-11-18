/**
 * The phone scan's gate may only skip text the detector would find nothing in, so redaction
 * stays byte for byte what the plain digit gate gave. The digit gate is kept here as the
 * reference, and the detector is spied on to see which texts reach it.
 */
import {
  findPhoneNumbersInText,
  getCountries,
  getCountryCallingCode,
  Metadata,
} from "libphonenumber-js";
import type * as PhoneLibrary from "libphonenumber-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { redactEssentialPiiInText } from "../essentialPii.ts";
import { NON_PHONE_TEXTS, PHONE_CANDIDATE_TEXTS } from "./fixtures/phone-gate-texts.fixture.ts";

vi.mock("libphonenumber-js", async (importOriginal) => {
  const actual = await importOriginal<typeof PhoneLibrary>();
  return { ...actual, findPhoneNumbersInText: vi.fn(actual.findPhoneNumbersInText) };
});

/** The gate as it stood alone before: six digits, at most four non-alphanumerics between. */
const DIGIT_GATE = /\d(?:[^0-9A-Za-z]{0,4}\d){5}/;

const detector = vi.mocked(findPhoneNumbersInText);
const detects = (text: string) => findPhoneNumbersInText(text, { defaultCountry: "US" }).length > 0;

interface GateRun {
  /** Texts the digit gate let through and the detector found a number in, yet were skipped. */
  skippedNumbers: string[];
  phones: number;
  reachedDigitGate: number;
  reachedDetector: number;
}

/**
 * A skipped text gets no phone spans; the old pipeline gave it phone spans only if the digit
 * gate passed and the detector found a number. So no skipped number means unchanged output,
 * and a text the gate runs takes the old path unchanged.
 */
function runGate(texts: readonly string[]): GateRun {
  const run: GateRun = {
    skippedNumbers: [],
    phones: 0,
    reachedDigitGate: 0,
    reachedDetector: 0,
  };
  for (const text of texts) {
    detector.mockClear();
    redactEssentialPiiInText({ text });
    const reached = detector.mock.calls.length > 0;
    const digitGate = DIGIT_GATE.test(text);
    const isPhone = digitGate && detects(text);
    if (digitGate) run.reachedDigitGate++;
    if (reached) run.reachedDetector++;
    if (isPhone) run.phones++;
    if (isPhone && !reached) run.skippedNumbers.push(text);
  }
  return run;
}

/** Every symbol, space or control character the detector accepts inside one number. */
function separatorTexts(): string[] {
  const texts: string[] = [];
  for (let code = 0; code < 0x10000; code++) {
    const separator = String.fromCharCode(code);
    if (/[\p{L}\p{N}\p{M}\p{Co}\p{Cn}\p{Cs}]/u.test(separator)) continue;
    if (detects(`+43${separator}1234`)) texts.push(`+43${separator}1234`);
  }
  return texts;
}

const SLOW = 60_000;

describe("given the phone scan's gate", () => {
  describe("when the text holds a number the digit gate let through", () => {
    let run: GateRun;
    beforeAll(() => {
      run = runGate(PHONE_CANDIDATE_TEXTS);
    }, SLOW);

    /** @scenario "The phone check skips nothing the digit check let through" */
    it("runs the detector on every one", () => {
      expect(run.phones).toBeGreaterThan(4000);
      expect(run.skippedNumbers).toEqual([]);
    });

    /** @scenario "The phone check skips nothing the digit check let through" */
    it(
      "still finds a number written with any separator the detector reads",
      () => {
        const texts = separatorTexts();
        expect(texts.length).toBeGreaterThan(20);
        const separators = runGate(texts);
        expect(separators.skippedNumbers).toEqual([]);
      },
      SLOW,
    );
  });

  describe("when the text is numeric but holds no number", () => {
    let run: GateRun;
    beforeAll(() => {
      run = runGate(NON_PHONE_TEXTS);
    }, SLOW);

    /** @scenario "Numeric text that cannot hold a phone number skips the phone scan" */
    it("skips the detector for most of it", () => {
      expect(run.reachedDigitGate).toBeGreaterThan(2000);
      expect(run.reachedDetector).toBeLessThan(run.reachedDigitGate / 2);
    });

    /** @scenario "The phone check skips nothing the digit check let through" */
    it("skips no text the detector finds a number in, so output is unchanged", () => {
      expect(run.skippedNumbers).toEqual([]);
    });
  });

  /**
   * The gate's shapes hold only while the detector's data does: no country's number shorter
   * than six digits with its calling code, `011` as the US exit code, and no seven- to
   * nine-digit national number but Canada's `310`. A library upgrade that breaks one fails here.
   */
  describe("when the detector's numbering data is read", () => {
    /** @scenario "The phone check skips nothing the digit check let through" */
    it(
      "holds no number the gate's shapes would miss",
      () => {
        const metadata = new Metadata();
        const shortest = getCountries().map((country) => {
          metadata.selectNumberingPlan(country);
          const lengths = metadata.numberingPlan?.possibleLengths() ?? [];
          return getCountryCallingCode(country).length + Math.min(...lengths);
        });
        expect(Math.min(...shortest)).toBeGreaterThanOrEqual(6);
        metadata.selectNumberingPlan("US");
        expect(metadata.numberingPlan?.IDDPrefix()).toBe("011");

        const shortNational: string[] = [];
        for (let prefix = 0; prefix < 1000; prefix++) {
          for (const length of [7, 8, 9]) {
            const number = `${String(prefix).padStart(3, "0")}05550123`.slice(0, length);
            if (detects(`call ${number} now`) && !/^1?310/.test(number)) {
              shortNational.push(number);
            }
          }
        }
        expect(shortNational).toEqual([]);
      },
      SLOW,
    );
  });
});
