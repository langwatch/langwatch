// @vitest-environment node
import { describe, expect, it } from "vitest";

import { MAIL_PREVIEW_SPAWN_ENV, mailPreviewTool } from "../mail-preview";

const log = () => undefined;

describe("mail preview", () => {
  /** @scenario "The mail preview runs inside the dev server unless asked to run apart" */
  it("is hosted in the dev server's process by default", () => {
    const options = mailPreviewTool({ port: 5566, env: {}, log });

    expect(options.start).toBeTypeOf("function");
    expect("command" in options).toBe(false);
  });

  /** @scenario "The mail preview runs inside the dev server unless asked to run apart" */
  it("is spawned as its own process when the developer asks for it", () => {
    const options = mailPreviewTool({ port: 5566, env: { [MAIL_PREVIEW_SPAWN_ENV]: "1" }, log });

    expect(options.start).toBeUndefined();
    expect("command" in options && options.command({ port: 7000 }).args).toEqual(
      expect.arrayContaining(["@langwatch/mail", "dev", "--port", "7000"]),
    );
  });
});
