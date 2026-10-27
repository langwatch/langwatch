import type { GoogleDlpChannel, GoogleDlpFinding } from "../google-dlp.channel.ts";

type Inspection = Readonly<{ text: string; infoTypes: readonly string[] }>;

/** Records every inspection and answers from a scripted queue; an empty queue refuses by name. */
export class MemoryGoogleDlpChannel implements GoogleDlpChannel {
  static create(): MemoryGoogleDlpChannel {
    return new MemoryGoogleDlpChannel();
  }

  readonly inspections: Inspection[] = [];
  readonly #answers: GoogleDlpFinding[][] = [];
  closed = false;

  private constructor() {}

  answerWith(findings: GoogleDlpFinding[]): void {
    this.#answers.push(findings);
  }

  async inspect(input: Inspection): Promise<GoogleDlpFinding[]> {
    this.inspections.push(input);
    const answer = this.#answers.shift();
    if (!answer) throw new Error("no scripted Google DLP answer");
    return answer;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
