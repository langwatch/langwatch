/**
 * Texts for the phone gate's equivalence proof: candidate phone texts and numeric text that
 * is no phone number. Every number is reserved for drama, a library example or synthetic.
 * Which candidates are phones is decided by the detector at test time, not here.
 */
import { getCountries, getExampleNumber } from "libphonenumber-js";
import examples from "libphonenumber-js/mobile/examples";

/** Numbers written by hand per region, in the formats that region uses. */
const WRITTEN_NUMBERS = [
  // US and Canada: 555-01xx is reserved for fiction.
  "202-555-0123",
  "(202) 555-0187",
  "202.555.0144",
  "2025550199",
  "202 555 0123",
  "202/555-0123",
  "+1 202 555 0123",
  "+12025550123",
  "12025550123",
  "1-202-555-0123",
  "1 (202) 555-0123",
  "+1 (202) 555-0123",
  "+1-202-555-0123",
  "+1.202.555.0123",
  "001 202 555 0123",
  "011 44 20 7946 0018",
  "011 31 6 12345678",
  "01143 1 2345",
  "202 555 0123 ext. 42",
  "202-555-0123 x99",
  "+1 202 555 0123 ext 7",
  "202-555-0123#",
  "tel:+1-202-555-0123",
  "+1 613 555 0150",
  "(416) 555-0134",
  "310-4567",
  "1 310 4567",
  // UK: Ofcom drama ranges.
  "020 7946 0018",
  "+44 20 7946 0018",
  "+44 (0)20 7946 0018",
  "+442079460018",
  "442079460018",
  "0044 20 7946 0018",
  "07700 900123",
  "+44 7700 900123",
  "+44 7700-900-123",
  "0113 496 0000",
  "0117 496 0123",
  "+44 117 496 0123",
  // Netherlands, Germany, France.
  "+31 6 12345678",
  "06-12345678",
  "020-1234567",
  "+31 (0)20 123 4567",
  "0031 20 123 4567",
  "+31201234567",
  "+49 30 12345678",
  "030 12345678",
  "+49 (0)30 1234 5678",
  "0049 30 12345678",
  "+49 1512 3456789",
  "+49 30 1234",
  "+43 1 2345",
  "+43 1234",
  "+98 21 1234",
  "+33 1 23 45 67 89",
  "01 23 45 67 89",
  "06.12.34.56.78",
  "0033 6 12 34 56 78",
  "+33 (0)6 12 34 56 78",
  // Brazil, India, Japan, Australia (ACMA drama ranges), South Africa, Mexico.
  "+55 11 91234-5678",
  "(11) 91234-5678",
  "+55 (21) 2345-6789",
  "+5511912345678",
  "+91 98765 43210",
  "098765 43210",
  "+91-98765-43210",
  "+919876543210",
  "+81 3-1234-5678",
  "03-1234-5678",
  "090-1234-5678",
  "+81 90 1234 5678",
  "+61 491 570 156",
  "0491 570 157",
  "(02) 5550 1234",
  "+61 2 5550 1234",
  "+61 3 7010 1234",
  "+27 21 555 1234",
  "021 555 1234",
  "+27 82 555 1234",
  "+52 55 1234 5678",
  "55 1234 5678",
  "+52 1 55 1234 5678",
  // Other scripts and separators the detector reads.
  "＋４４ ２０ ７９４６ ００１８",
  "+44 20 7946 0018",
  "+44 20 7946 0018 / +44 20 7946 0019",
  "+1 202 555 0123 / 0124",
  "+٤٤ ٢٠ ٧٩٤٦ ٠٠١٨",
  "202 555 ０１２３",
];

/** One example number per region, written every way the detector might meet it. */
function exampleNumberShapes(): string[] {
  const shapes: string[] = [];
  for (const country of getCountries()) {
    const example = getExampleNumber(country, examples);
    if (!example) continue;
    const international = example.formatInternational();
    const national = example.formatNational();
    const digits = example.number.slice(1);
    shapes.push(
      example.number,
      international,
      national,
      digits,
      `00${digits}`,
      `011 ${digits}`,
      international.replace(/ /g, "-"),
      international.replace(/ /g, "."),
      international.replace(/ /g, ""),
      national.replace(/ /g, "-"),
      `${international} ext. 123`,
    );
  }
  return shapes;
}

/** The places a number sits: alone, in a sentence, beside punctuation and quotes, in JSON. */
function embeddingsOf(number: string): string[] {
  return [
    number,
    `call ${number} now`,
    `my number is ${number}.`,
    `(${number})`,
    `"${number}"`,
    `'${number}'`,
    `[${number}]`,
    `<${number}>`,
    `${number},`,
    `${number}\n`,
    `Phone:${number};`,
    `{"phone":"${number}"}`,
    `{"user":{"name":"Ada","phone":"${number}","age":36}}`,
    `order 12345 shipped, ring ${number} today`,
  ];
}

/**
 * Phone candidates: every written number in every embedding, and every example shape in
 * two embeddings, rotated so each embedding still meets every region's numbers.
 */
export const PHONE_CANDIDATE_TEXTS: readonly string[] = [
  ...WRITTEN_NUMBERS.flatMap(embeddingsOf),
  ...exampleNumberShapes().flatMap((shape, index) => {
    const embeddings = embeddingsOf(shape);
    return [embeddings[index % embeddings.length]!, embeddings[(index + 7) % embeddings.length]!];
  }),
];

/** A small deterministic generator, so the set is the same on every run. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const random = seededRandom(20_261_116);
const int = (max: number) => Math.floor(random() * max);
const pad = (value: number, width: number) => String(value).padStart(width, "0");
const hex = (length: number) =>
  Array.from({ length }, () => "0123456789abcdef"[int(16)]).join("");
const base62 = (length: number) =>
  Array.from(
    { length },
    () => "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"[int(62)],
  ).join("");

function oneOfEachNonPhone(): string[] {
  const year = 2000 + int(30);
  const date = `${year}-${pad(1 + int(12), 2)}-${pad(1 + int(28), 2)}`;
  const time = `${pad(int(24), 2)}:${pad(int(60), 2)}:${pad(int(60), 2)}`;
  const millis = pad(int(1000), 3);
  const epochSeconds = 1_500_000_000 + int(300_000_000);
  const uuid = `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
  return [
    `${date}T${time}.${millis}Z`,
    `${date}T${time}+01:00`,
    `${date}T${time}.${millis}+05:30`,
    `${date} ${time}`,
    `${date} ${time}.${millis}`,
    `${pad(1 + int(28), 2)}/${pad(1 + int(12), 2)}/${year} ${time}`,
    `${date}`,
    String(epochSeconds),
    `${epochSeconds}${millis}`,
    `${epochSeconds}${millis}${pad(int(1_000_000), 6)}`,
    `{"timestamp":${epochSeconds}${millis},"duration_ms":${int(100_000)}}`,
    uuid,
    `{"id":"${uuid}","parent":"${hex(16)}"}`,
    `${base62(27)}`,
    `trace ${hex(32)} span ${hex(16)}`,
    `traceparent: 00-${hex(32)}-${hex(16)}-01`,
    `sha ${hex(40)}`,
    `v${int(30)}.${int(20)}.${int(100)}`,
    `${int(10)}.${int(30)}.${int(10)}-rc.${int(5)}+build.${int(9999)}`,
    `{"input_tokens":${int(200_000)},"output_tokens":${int(20_000)},"total_tokens":${int(220_000)}}`,
    `gen_ai.usage.input_tokens=${int(2_000_000)}`,
    `cost $${int(10_000)}.${pad(int(100), 2)} for ${int(100_000)} requests`,
    `€ ${int(1000)}.${pad(int(1000), 3)},${pad(int(100), 2)}`,
    `$${int(10)},${pad(int(1000), 3)},${pad(int(1000), 3)}.${pad(int(100), 2)}`,
    `took ${int(10_000_000)}ms (${int(10_000)}.${pad(int(1000), 3)}s)`,
    `latencies [${int(1000)}, ${int(1000)}, ${int(1000)}, ${int(1000)}, ${int(1000)}]`,
    `${int(256)}.${int(256)}.${int(256)}.${int(256)}:${int(65_536)}`,
    `listening on 0.0.0.0:${int(65_536)}`,
    `2001:db8:${hex(4)}::${hex(4)}`,
    `card 4111 1111 1111 1111 ok`,
    `card 4111-1111-1111-1111 ok`,
    `ssn ${pad(int(1000), 3)}-${pad(int(100), 2)}-${pad(int(10_000), 4)}`,
    `iban GB82WEST12345698765432 ok`,
    `worker-${hex(9)}-${base62(5).toLowerCase()}`,
    `req_${base62(24)}`,
    `build ${year}${pad(1 + int(12), 2)}${pad(1 + int(28), 2)}.${int(10)}`,
    `${int(1_000_000_000)} bytes`,
    `${int(90)}.${pad(int(10_000), 4)}, ${int(180)}.${pad(int(10_000), 4)}`,
    `${int(100)}.${pad(int(1_000_000), 6)}%`,
    `${int(10)}.${pad(int(1000), 3)}e+${int(20)}`,
    `at handler (src/app/${hex(6)}.ts:${int(5000)}:${int(120)})`,
    `page ${int(1000)} of ${int(100_000)}, offset ${int(10_000_000)}`,
    `{"score":0.${pad(int(1_000_000_000), 9)},"rank":${int(1000)}}`,
    `retry ${int(10)} of ${int(10)} after ${int(100_000)} ms, attempt id ${int(1_000_000)}`,
  ];
}

/** Numeric text that is no phone number, the bulk of what a span carries. */
export const NON_PHONE_TEXTS: readonly string[] = Array.from({ length: 60 }, oneOfEachNonPhone)
  .flat()
  .concat([
    "the release notes for the 3.9.0 tag say so",
    '{"input_tokens":15234,"cost_usd":0.0412}',
    "retry 3 times after 45 seconds",
    "hosted-eu-20260812-09",
    '{"id":"hosted-eu-20260812-09","region":"eu-west-1"}',
  ]);
