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
  INSTANT_EVALS_SETUP_HREF,
  InstantEvalRefusalPopover,
  instantEvalRefusalCopy,
  type InstantEvalRefusal,
  MODEL_PROVIDERS_HREF,
  OWN_MODEL_LINK,
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
    if ("turnOn" in copy) throw new Error("a model refusal is not the self-hosted way in");

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
    expect(screen.queryByText(/LangWatch Instant \(preview\)/)).toBeNull();

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
          { value: "langwatch/instant-preview", label: "LangWatch Instant (preview)" },
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
    expect(options.some((row) => row.dataset.value === "langwatch/instant-preview")).toBe(false);
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
    expect(screen.queryByText(/LangWatch Instant \(preview\)/)).toBeNull();
  });

  /** @scenario "Instant Evals off for an enterprise organization open the contact-us popover" */
  it("offers Contact us, never the own model, and only closes when the switch is off", () => {
    const copy = instantEvalRefusalCopy({ kind: "unreleased" });

    expect(copy).toMatchObject({
      title: "Instant Evals aren't enabled for this project yet",
      body: "Instant Evals are a powerful new tool that turns plain language questions into native filters. Contact us so we can activate LangWatch Instant (preview), our hosted model, for you.",
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
  const withoutHostedJudging = ["not_in_license", "not_connected", "ask_operator"] as const;

  function renderRefusal(
    kind: "not_in_license" | "switched_off" | "not_connected" | "ask_operator",
    {
      canManageOrganization = false,
      offersOwnModel = true,
      onClose = () => {},
    }: { canManageOrganization?: boolean; offersOwnModel?: boolean; onClose?: () => void } = {},
  ) {
    render(
      <InstantEvalRefusalPopover
        refusal={{ kind }}
        onClose={onClose}
        onSkip={() => {}}
        onEnable={() => {}}
        isEnabling={false}
        canManageOrganization={canManageOrganization}
        offersOwnModel={offersOwnModel}
      >
        <span>anchor</span>
      </InstantEvalRefusalPopover>,
      { wrapper },
    );
  }

  describe("when the install has no hosted judging", () => {
    /** @scenario "Each self-hosted refusal says what to do about it" */
    it.each(withoutHostedJudging)(
      "reads Turn on Instant Evals for %s, never Enterprise or license",
      (kind) => {
        renderRefusal(kind, { canManageOrganization: true });
        const popover = screen.getByTestId("instant-eval-refusal");
        expect(screen.getByText("Turn on Instant Evals")).toBeInTheDocument();
        expect(popover.textContent).not.toMatch(/enterprise|licen[cs]e/i);
        expect(screen.queryByText("Contact us")).toBeNull();
      },
    );
  });

  describe("when the reader may manage the organization", () => {
    /** @scenario "A self-hosted admin is offered two ways to turn Instant Evals on" */
    it("offers LangWatch Instant (preview) first, then the own decision model, each with its button", () => {
      renderRefusal("not_in_license", { canManageOrganization: true });
      const hosted = screen.getByTestId("instant-eval-turn-on-hosted");
      const ownModel = screen.getByTestId("instant-eval-turn-on-own-model");
      expect(
        hosted.compareDocumentPosition(ownModel) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(within(hosted).getByText("LangWatch Instant (preview)")).toBeInTheDocument();
      expect(within(hosted).getByText("Recommended")).toBeInTheDocument();
      expect(within(hosted).getByText(/You pay per eval/)).toBeInTheDocument();
      expect(within(hosted).getByRole("link", { name: "Connect to LangWatch" })).toHaveAttribute(
        "href",
        CONNECT_SETTINGS_HREF,
      );
      expect(within(ownModel).getByText("Your own decision model")).toBeInTheDocument();
      expect(within(ownModel).getByText(/You pay the provider/)).toBeInTheDocument();
      expect(within(ownModel).getByRole("link", { name: "Add a key" })).toHaveAttribute(
        "href",
        INSTANT_EVALS_SETUP_HREF,
      );
      expect(screen.queryByTestId("instant-eval-ask-admin")).toBeNull();
    });

    /** @scenario "A self-hosted admin is offered two ways to turn Instant Evals on" */
    it("closes on Not now", () => {
      const onClose = vi.fn();
      renderRefusal("not_connected", { canManageOrganization: true, onClose });
      fireEvent.click(screen.getByRole("button", { name: "Not now" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the reader may not manage the organization", () => {
    /** @scenario "A self-hosted member sees the two ways and a link to send an admin" */
    it("shows both ways with no button, and copies the setup link for an admin", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      renderRefusal("ask_operator");

      expect(screen.getByTestId("instant-eval-turn-on-hosted")).toBeInTheDocument();
      expect(screen.getByTestId("instant-eval-turn-on-own-model")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Connect to LangWatch" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Add a key" })).toBeNull();
      expect(screen.getByText("Only an admin can turn this on")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Copy link" }));

      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}${INSTANT_EVALS_SETUP_HREF}`,
      );
      expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    });

    /** @scenario "A member whose browser can't copy is left the link to copy by hand" */
    it("keeps the link on screen and says to copy it by hand when the write is refused", async () => {
      const writeText = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      renderRefusal("ask_operator");

      await userEvent.click(screen.getByRole("button", { name: "Copy link" }));

      expect(await screen.findByText(/Select the link above/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
      expect(screen.getByTestId("instant-eval-ask-admin-address")).toHaveTextContent(
        `${window.location.origin}${INSTANT_EVALS_SETUP_HREF}`,
      );
    });

    /** @scenario "A member whose browser can't copy is left the link to copy by hand" */
    it("says to copy it by hand when the browser has no clipboard", async () => {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
      renderRefusal("ask_operator");

      await userEvent.click(screen.getByRole("button", { name: "Copy link" }));

      expect(await screen.findByText(/Select the link above/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
    });
  });

  describe("when own decision models are switched off for the organization", () => {
    /** @scenario "With own decision models switched off, a self-hosted install is offered LangWatch Instant (preview) only" */
    it("shows only the LangWatch Instant (preview) card", () => {
      renderRefusal("not_in_license", { canManageOrganization: true, offersOwnModel: false });
      expect(screen.getByTestId("instant-eval-turn-on-hosted")).toBeInTheDocument();
      expect(screen.queryByTestId("instant-eval-turn-on-own-model")).toBeNull();
      expect(screen.getByTestId("instant-eval-refusal").textContent).not.toMatch(
        /own decision model/i,
      );
    });

    /** @scenario "With own decision models switched off, a self-hosted install is offered LangWatch Instant (preview) only" */
    it("gives a member the Connect settings link to send", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      renderRefusal("not_in_license", { offersOwnModel: false });

      await userEvent.click(screen.getByRole("button", { name: "Copy link" }));

      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${CONNECT_SETTINGS_HREF}`);
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

  // Unreleased picks the model in place instead; its own test pins the picker. A self-hosted
  // install without hosted judging offers the own model as a card, pinned below.
  const turnOnKinds: readonly string[] = ["not_in_license", "not_connected", "ask_operator"];
  const linked = gated.filter(
    (refusal) => refusal.kind !== "unreleased" && !turnOnKinds.includes(refusal.kind),
  );

  /** @scenario "Every refusal of LangWatch's own model offers the project's own decision model" */
  it.each(gated.filter((refusal) => turnOnKinds.includes(refusal.kind)))(
    "offers $kind the own decision model as the second card",
    (refusal) => {
      render(
        <InstantEvalRefusalPopover
          refusal={refusal}
          onClose={vi.fn()}
          onSkip={vi.fn()}
          onEnable={vi.fn()}
          isEnabling={false}
          offersOwnModel
          canManageOrganization
        >
          <span>anchor</span>
        </InstantEvalRefusalPopover>,
        { wrapper },
      );

      expect(screen.getByTestId("instant-eval-turn-on-own-model")).toBeInTheDocument();
    },
  );

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
      expect(screen.queryByTestId("instant-eval-turn-on-own-model")).toBeNull();
    },
  );

  /** @scenario "Every refusal of LangWatch's own model offers the project's own decision model" */
  it("offers no own-model link when the judge can't run right now", () => {
    const copy = instantEvalRefusalCopy({ kind: "model" });

    expect("ownModel" in copy ? copy.ownModel : undefined).toBeUndefined();
  });
});
