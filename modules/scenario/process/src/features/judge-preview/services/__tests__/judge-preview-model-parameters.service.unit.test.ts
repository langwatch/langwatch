/**
 * The parameters a run's judge gets when it is LangWatch Judge (preview), or why the run is
 * refused before it starts.
 * @see modules/scenario/specs/judge-preview.feature
 */
import { describe, expect, it } from "vitest";

import { judgePreviewAvailabilityFixture } from "../../../../__tests__/support/judge-preview.fixture.ts";
import { JudgePreviewModelParametersService } from "../judge-preview-model-parameters.service.ts";

const PROJECT_ID = "project-1";

describe("JudgePreviewModelParametersService", () => {
  const prepare = ({
    isSaas = true,
    isFlagOn = true,
    isConfigured = true,
    langwatchEndpoint = "https://app.langwatch.test/",
  } = {}) =>
    JudgePreviewModelParametersService.create({
      availability: judgePreviewAvailabilityFixture({ isSaas, isFlagOn, isConfigured }),
      langwatchEndpoint,
    }).prepare({ projectId: PROJECT_ID, runKey: "run-key-1" });

  /** @scenario "A run judged by LangWatch Judge (preview) is pointed at the app's own endpoint" */
  it("names the OpenAI-shaped model, the app's judge preview address and the run's key", async () => {
    await expect(prepare()).resolves.toEqual({
      success: true,
      params: {
        model: "openai/langwatch-judge-preview",
        api_base: "https://app.langwatch.test/api/judge-preview/v1",
        api_key: "run-key-1",
      },
    });
  });

  /** @scenario "A run on LangWatch Judge (preview) is refused before it starts where it may not judge" */
  it("refuses on a self-hosted install and with the flag off, saying what to pick instead", async () => {
    const selfHosted = await prepare({ isSaas: false });
    const flagOff = await prepare({ isFlagOn: false });

    expect(selfHosted).toMatchObject({
      success: false,
      message: expect.stringMatching(
        /LangWatch Judge \(preview\) runs on LangWatch Cloud only.*Pick another judge model/,
      ),
    });
    expect(flagOff).toMatchObject({
      success: false,
      message: expect.stringMatching(
        /LangWatch Judge \(preview\) is not turned on.*Pick another judge model/,
      ),
    });
  });

  /** @scenario "A run on LangWatch Judge (preview) is refused before it starts where it is not set up" */
  it("refuses a run before it starts where the route table names no turn decision backend", async () => {
    await expect(prepare({ isConfigured: false })).resolves.toEqual({
      success: false,
      reason: "provider_not_enabled",
      message:
        "LangWatch Judge (preview) is not set up on this installation yet, so it cannot judge. Pick another judge model on the scenario, the suite or in Default models.",
    });
  });

  /** @scenario "An endpoint on an install with no own address is refused" */
  it("refuses when the installation's own address is not configured", async () => {
    await expect(prepare({ langwatchEndpoint: "" })).resolves.toMatchObject({
      success: false,
      reason: "missing_params",
    });
  });
});
