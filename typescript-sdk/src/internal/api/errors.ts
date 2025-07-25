export class LangWatchApiError extends Error {
  public readonly httpStatus: number;
  public readonly httpStatusText: string;
  public apiError: string | undefined;
  public body: unknown;

  constructor(message: string, response: Response) {
    super(message);
    this.httpStatus = response.status;
    this.httpStatusText = response.statusText;
  }

  async safeParseBody(response: Response): Promise<void> {
    try {
      if (response.headers.get("Content-Type")?.includes("application/json")) {
        const json = await response.json();

        this.body = json;

        if (json.error && typeof json.error === "string") {
          this.apiError = json.error;
        }

        return;
      }

      this.body = await response.text();
    } catch {
      this.body = null;
    }
  }
}
