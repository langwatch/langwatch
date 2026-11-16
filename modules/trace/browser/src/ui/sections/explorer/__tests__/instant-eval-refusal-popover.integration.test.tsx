/**
 * @vitest-environment jsdom
 *
 * The popover an Instant Eval refusal opens under the search bar.
 * @see specs/traces-v2/instant-eval-search.feature ("A refusal is a popover, never an error state")
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DECISION_MODEL_PICKER_PLACEHOLDER } from "../decision-model-picker.tsx";
import {
  CONNECT_SETTINGS_HREF,
  CONTACT_US_HREF,
  InstantEvalRefusalPopover,
  instantEvalRefusalCopy,
  type InstantEvalRefusal,
  MODEL_PROVIDERS_HREF,
  OWN_MODEL_LINK,
  SELF_HOSTED_INSTANT_EVALS_HREF,
  UPGRADE_HREF,
  WHERE_THE_TEXT_GOES_HREF,
} from "../instant-eval-refusal-popover.tsx";

const wrapper = ({ children }: { children: ReactNode }) => (
  <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
);

afterEach(() => cleanup());

/** The rows of the listbox a picker's trigger controls. */
function pickerOptions(trigger: HTMLElement): HTMLElement[] {
  const listbox = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
  if (!listbox) throw new Error("no listbox for the decision model picker");
  return within(listbox).getAllByRole("option", { hidden: true });
}

function optionFor(options: HTMLElement[], value: string): HTMLElement {
  const option = options.find((row) => row.dataset.value === value);
  if (!option) throw new Error(`no option for ${value}`);
  return option;
}

describe("given the organization has spent its free Instant Evals budget", () => {
  /** @scenario "A spent free budget opens the budget popover and keeps the eval chip" */
  it("says in one line what Instant Evals find, and offers Upgrade and Skip", () => {
    const onSkip = vi.fn();
    render(
      <InstantEvalRefusalPopover
        refusal={{ kind: "budget" }}
        onClose={vi.fn()}
        onSkip={onSkip}
        onEnable={vi.fn()}
        isEnabling={false}
      >
        <span>anchor</span>
      </InstantEvalRefusalPopover>,
      { wrapper },
    );

    expect(screen.getByText("Your free Instant Evals quota is used up")).toBeTruthy();
    expect(
      screen.getByText(
        "An Instant Eval reads every result in this view and keeps the ones that answer your question, which no filter can do. Upgrade to keep judging. Skip searches your words without the eval.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Compare plans" }).getAttribute("href")).toBe(
      UPGRADE_HREF,
    );

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});

describe("given the deployment has no classifier", () => {
  /** @scenario "A missing classifier opens the model popover and keeps the eval chip" */
  it("says Instant Evals can't run right now and offers a word with us, not the model settings", () => {
    const copy = instantEvalRefusalCopy({ kind: "model" });
    if ("lock" in copy) throw new Error("a model refusal is not the license lock");

    expect(copy.title).toBe("Instant Evals can't run right now");
    expect(copy.body).toBe(
      "Skip searches your words without the eval. If it keeps happening, contact us.",
    );
    expect(copy.action).toEqual({ label: "Contact us", href: CONTACT_US_HREF });
  });
});

describe("given the Instant Evals flag is off for the project", () => {
  /** @scenario "Instant Evals off for an enterprise organization ask for a decision model of its own" */
  it("asks for a decision model in a picker, offers no Contact us, and dismisses on Not now", () => {
    const onClose = vi.fn();
    const onSkip = vi.fn();
    render(
      <InstantEvalRefusalPopover
        refusal={{ kind: "unreleased" }}
        onClose={onClose}
        onSkip={onSkip}
        onEnable={vi.fn()}
        isEnabling={false}
        offersOwnModel
        canPickDecisionModel
        decisionModels={[]}
        onPickDecisionModel={vi.fn()}
      >
        <span>anchor</span>
      </InstantEvalRefusalPopover>,
      { wrapper },
    );

    expect(screen.getByText("Pick a decision model")).toBeTruthy();
    expect(screen.getByText("Instant Evals run on a decision model of your own.")).toBeTruthy();
    expect(screen.getByTestId("decision-model-picker")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Contact us" })).toBeNull();
    expect(screen.queryByText(/Evals Preview/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSkip).not.toHaveBeenCalled();
  });

  /** @scenario "The eval popover picks the project's own decision model in place" */
  it("lists the own models as Default models does, greys the keyless, and hands the pick back", async () => {
    const onPickDecisionModel = vi.fn();
    render(
      <InstantEvalRefusalPopover
        refusal={{ kind: "unreleased" }}
        onClose={vi.fn()}
        onSkip={vi.fn()}
        onEnable={vi.fn()}
        isEnabling={false}
        offersOwnModel
        canPickDecisionModel
        decisionModels={[
          { value: "langwatch/instant-evals", label: "Evals Preview" },
          { value: "azure/decisions:microsoft-decision-1", label: "Azure Microsoft Decision 1" },
        ]}
        onPickDecisionModel={onPickDecisionModel}
      >
        <span>anchor</span>
      </InstantEvalRefusalPopover>,
      { wrapper },
    );

    const trigger = within(screen.getByTestId("decision-model-picker")).getByRole("combobox");
    expect(trigger.textContent).toContain(DECISION_MODEL_PICKER_PLACEHOLDER);
    const user = userEvent.setup();
    await user.click(trigger);
    const options = pickerOptions(trigger);
    expect(options.some((row) => row.dataset.value === "langwatch/instant-evals")).toBe(false);
    const keyless = optionFor(options, "openai/decisions:gpt-6-luna");
    expect(keyless.getAttribute("aria-disabled")).toBe("true");
    expect(keyless.textContent).toContain("Add an OpenAI key in Model Providers to use it.");
    const footer = screen.getByTestId("provider-model-selector-footer");
    const configure = within(footer).getByTestId("decision-model-picker-configure");
    expect(configure.getAttribute("href")).toBe(MODEL_PROVIDERS_HREF);
    expect(configure.getAttribute("target")).toBe("_blank");

    await user.click(optionFor(options, "azure/decisions:microsoft-decision-1"));

    expect(onPickDecisionModel).toHaveBeenCalledWith("azure/decisions:microsoft-decision-1");
  });

  /** @scenario "A reader who can't set the project's default models is sent to an admin" */
  it("sends a reader who can't manage the project to an admin, with no picker", () => {
    render(
      <InstantEvalRefusalPopover
        refusal={{ kind: "unreleased" }}
        onClose={vi.fn()}
        onSkip={vi.fn()}
        onEnable={vi.fn()}
        isEnabling={false}
        offersOwnModel
        decisionModels={[]}
        onPickDecisionModel={vi.fn()}
      >
        <span>anchor</span>
      </InstantEvalRefusalPopover>,
      { wrapper },
    );

    expect(screen.getByText("Instant Evals need a decision model")).toBeTruthy();
    expect(screen.getByText(/Ask a project admin to pick one in Default models\./)).toBeTruthy();
    expect(screen.queryByTestId("decision-model-picker")).toBeNull();
    const link = screen.getByTestId("instant-eval-own-model-link");
    expect(link.getAttribute("href")).toBe(MODEL_PROVIDERS_HREF);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("link", { name: "Contact us" })).toBeNull();
    expect(screen.queryByText(/Evals Preview/)).toBeNull();
  });

  /** @scenario "Instant Evals off for an enterprise organization open the contact-us popover" */
  it("offers Contact us, never the own model, and only closes when the switch is off", () => {
    const copy = instantEvalRefusalCopy({ kind: "unreleased" });

    expect(copy).toMatchObject({
      title: "Instant Evals aren't enabled for this project yet",
      body: "Instant Evals are a powerful new tool that turns plain language questions into native filters. Contact us so we can activate Evals Preview, our hosted model, for you.",
      action: { label: "Contact us", href: CONTACT_US_HREF },
    });
    expect(copy.ownModel).toBeUndefined();

    const onClose = vi.fn();
    const onSkip = vi.fn();
    render(
      <InstantEvalRefusalPopover
        refusal={{ kind: "unreleased" }}
        onClose={onClose}
        onSkip={onSkip}
        onEnable={vi.fn()}
        isEnabling={false}
      >
        <span>anchor</span>
      </InstantEvalRefusalPopover>,
      { wrapper },
    );
    expect(screen.queryByTestId("instant-eval-own-model-link")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSkip).not.toHaveBeenCalled();
  });

  it("renders nothing while there is no refusal", () => {
    render(
      <InstantEvalRefusalPopover
        refusal={null}
        onClose={vi.fn()}
        onSkip={vi.fn()}
        onEnable={vi.fn()}
        isEnabling={false}
      >
        <span>anchor</span>
      </InstantEvalRefusalPopover>,
      { wrapper },
    );

    expect(screen.queryByTestId("instant-eval-refusal")).toBeNull();
  });
});

const WHERE_IT_GOES =
  "Instant Evals send the text of your traces and your question to the model that judges them, under a data processing agreement. It is never used to train the model.";

describe("given Instant Evals are off for a self-serve organization", () => {
  /** @scenario "Instant Evals off for a self-serve organization open the enable popover" */
  it("explains where the text goes, and Enable throws the switch", () => {
    const onEnable = vi.fn();
    const onClose = vi.fn();
    const onSkip = vi.fn();
    render(
      <InstantEvalRefusalPopover
        refusal={{ kind: "opt_in" }}
        onClose={onClose}
        onSkip={onSkip}
        onEnable={onEnable}
        isEnabling={false}
      >
        <span>anchor</span>
      </InstantEvalRefusalPopover>,
      { wrapper },
    );

    expect(screen.getByText("Turn on Instant Evals for your organization")).toBeTruthy();
    expect(
      screen.getByText(
        `${WHERE_IT_GOES} Enable turns this on for every project in your organization.`,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Read more" }).getAttribute("href")).toBe(
      WHERE_THE_TEXT_GOES_HREF,
    );

    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    expect(onEnable).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSkip).not.toHaveBeenCalled();
  });
});

describe("given a member who may not throw the organization's switch", () => {
  /** @scenario "A member who may not throw the switch is told to ask an admin" */
  it("tells them to ask an admin, with no Enable button", () => {
    render(
      <InstantEvalRefusalPopover
        refusal={{ kind: "ask_admin" }}
        onClose={vi.fn()}
        onSkip={vi.fn()}
        onEnable={vi.fn()}
        isEnabling={false}
      >
        <span>anchor</span>
      </InstantEvalRefusalPopover>,
      { wrapper },
    );

    expect(
      screen.getByText("Instant Evals aren't turned on for your organization yet"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        `${WHERE_IT_GOES} Ask an organization admin to turn it on for every project in your organization.`,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
    expect(screen.getByRole("link", { name: "Read more" })).toBeTruthy();
  });
});

describe("given a self-hosted install that judges through LangWatch", () => {
  describe("when the judge can't be reached for an eval chip", () => {
    /** @scenario "A judgement that fails on an install judging through LangWatch names the addresses it needs" */
    it("names both addresses and still offers to contact us", () => {
      render(
        <InstantEvalRefusalPopover
          refusal={{ kind: "model" }}
          onClose={() => {}}
          onSkip={() => {}}
          onEnable={() => {}}
          isEnabling={false}
          viaConnect
        >
          <span>anchor</span>
        </InstantEvalRefusalPopover>,
        { wrapper },
      );
      expect(
        screen.getByText(
          "This install judges through LangWatch, so check that it can reach connect.langwatch.ai and gateway.langwatch.ai. Skip searches your words without the eval. If it keeps happening, contact us.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Contact us" })).toHaveAttribute(
        "href",
        CONTACT_US_HREF,
      );
    });
  });
});

describe("given an eval chip refused on a self-hosted install", () => {
  function renderRefusal(
    kind: "not_in_license" | "switched_off" | "not_connected" | "ask_operator",
    { canActivateLicense = false }: { canActivateLicense?: boolean } = {},
  ) {
    render(
      <InstantEvalRefusalPopover
        refusal={{ kind }}
        onClose={() => {}}
        onSkip={() => {}}
        onEnable={() => {}}
        isEnabling={false}
        canActivateLicense={canActivateLicense}
      >
        <span>anchor</span>
      </InstantEvalRefusalPopover>,
      { wrapper },
    );
  }

  describe("when its license does not include Instant Evals, or no license is installed", () => {
    /** @scenario "Each self-hosted refusal says what to do about it" */
    it("shows the Enterprise lock to an admin, both buttons on the License page", () => {
      renderRefusal("not_in_license", { canActivateLicense: true });
      expect(screen.getByText("Instant Evals is part of LangWatch Enterprise")).toBeInTheDocument();
      expect(screen.queryByText(/license doesn't include/)).toBeNull();
      expect(screen.getByRole("link", { name: "Activate a license" })).toHaveAttribute(
        "href",
        "/settings/license",
      );
      expect(screen.getByRole("link", { name: "Get a license" })).toHaveAttribute(
        "href",
        "/settings/license",
      );
      expect(screen.getByRole("link", { name: "Read more" })).toHaveAttribute(
        "href",
        SELF_HOSTED_INSTANT_EVALS_HREF,
      );
      expect(screen.queryByText("Contact us")).toBeNull();
    });

    /** @scenario "Each self-hosted refusal says what to do about it" */
    it("tells a member to ask an organization admin, with no license button", () => {
      renderRefusal("not_in_license");
      expect(
        screen.getByText(/Ask an organization admin to activate a license\./),
      ).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Activate a license" })).toBeNull();
      expect(screen.getByRole("button", { name: "Not now" })).toBeInTheDocument();
    });
  });

  describe("when an organization admin switched them off", () => {
    /** @scenario "Each self-hosted refusal says what to do about it" */
    it("names Settings, Connect, links there, and offers no Contact us", () => {
      renderRefusal("switched_off");
      expect(screen.getByText(/switch them back on in Settings, Connect/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open Connect settings" })).toHaveAttribute(
        "href",
        CONNECT_SETTINGS_HREF,
      );
      expect(screen.queryByText("Contact us")).toBeNull();
    });
  });

  describe("when the install isn't connected to LangWatch", () => {
    /** @scenario "Each self-hosted refusal says what to do about it" */
    it("names both addresses and links Read more, with no Contact us", () => {
      renderRefusal("not_connected");
      expect(screen.getByText("This install isn't connected to LangWatch")).toBeInTheDocument();
      expect(
        screen.getByText(/connect\.langwatch\.ai and gateway\.langwatch\.ai/),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Read more" })).toHaveAttribute(
        "href",
        SELF_HOSTED_INSTANT_EVALS_HREF,
      );
      expect(screen.queryByText("Contact us")).toBeNull();
    });
  });

  describe("when the install judges with its own key", () => {
    /** @scenario "Each self-hosted refusal says what to do about it" */
    it("sends the reader to whoever runs the install, with no Contact us", () => {
      renderRefusal("ask_operator");
      expect(screen.getByText("Instant Evals are off on this install")).toBeInTheDocument();
      expect(screen.getByText(/whoever runs it decides/)).toBeInTheDocument();
      expect(screen.queryByText("Contact us")).toBeNull();
    });
  });
});

describe("given an eval chip refused by a gate on LangWatch's own model", () => {
  const gated: InstantEvalRefusal[] = [
    { kind: "budget" },
    { kind: "opt_in" },
    { kind: "ask_admin" },
    { kind: "unreleased" },
    { kind: "not_in_license" },
    { kind: "switched_off" },
    { kind: "not_connected" },
    { kind: "ask_operator" },
  ];

  // Unreleased picks the model in place instead; its own test pins the picker.
  const linked = gated.filter((refusal) => refusal.kind !== "unreleased");

  /** @scenario "Every refusal of LangWatch's own model offers the project's own decision model" */
  it.each(linked)(
    "links $kind to Default models for the project's own decision model",
    (refusal) => {
      expect(instantEvalRefusalCopy(refusal, { offersOwnModel: true }).ownModel).toEqual(
        OWN_MODEL_LINK,
      );

      render(
        <InstantEvalRefusalPopover
          refusal={refusal}
          onClose={vi.fn()}
          onSkip={vi.fn()}
          onEnable={vi.fn()}
          isEnabling={false}
          offersOwnModel
        >
          <span>anchor</span>
        </InstantEvalRefusalPopover>,
        { wrapper },
      );

      const link = screen.getByTestId("instant-eval-own-model-link");
      expect(link.getAttribute("href")).toBe(MODEL_PROVIDERS_HREF);
      // A new tab, so the typed query the popover keeps survives the detour.
      expect(link.getAttribute("target")).toBe("_blank");
    },
  );

  /** @scenario "Every refusal of LangWatch's own model offers the project's own decision model" */
  it.each(gated)(
    "offers no own-model link for $kind when the own-model switch is off",
    (refusal) => {
      render(
        <InstantEvalRefusalPopover
          refusal={refusal}
          onClose={vi.fn()}
          onSkip={vi.fn()}
          onEnable={vi.fn()}
          isEnabling={false}
        >
          <span>anchor</span>
        </InstantEvalRefusalPopover>,
        { wrapper },
      );

      expect(screen.queryByTestId("instant-eval-own-model-link")).toBeNull();
    },
  );

  /** @scenario "Every refusal of LangWatch's own model offers the project's own decision model" */
  it("offers no own-model link when the judge can't run right now", () => {
    const copy = instantEvalRefusalCopy({ kind: "model" });

    expect("ownModel" in copy ? copy.ownModel : undefined).toBeUndefined();
  });
});
