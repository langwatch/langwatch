/** One Google DLP finding over the inspected text, in codepoints as DLP reports them. */
export type GoogleDlpFinding = Readonly<{
  start: number;
  end: number;
  /** The matched text DLP quoted back, when it did. */
  quote: string | undefined;
}>;

/** Google Cloud DLP, as this module reaches it: one inspection of one text. */
export interface GoogleDlpChannel {
  /** Refuses by name when this deployment holds no usable DLP service account. */
  inspect(input: { text: string; infoTypes: readonly string[] }): Promise<GoogleDlpFinding[]>;
  close(): Promise<void>;
}
