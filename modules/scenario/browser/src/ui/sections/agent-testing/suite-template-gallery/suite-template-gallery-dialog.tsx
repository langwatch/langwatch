/**
 * The template gallery: pick an archetype or a red team pack, read every scenario it holds, say
 * how it fits the agent under test, then create the suite in one step.
 * @see modules/scenario/specs/suite-template-gallery.feature
 */

import { ContentTabs } from "@langwatch/design-system/content-tabs";
import { Dialog } from "@langwatch/design-system/dialog";
import { Skeleton, VStack } from "@langwatch/design-system/primitives";
import type { SuiteTemplate } from "@langwatch/suite-contract";

import { TAB_LABELS, TemplateCards, TemplatePreview } from "./suite-template-cards.tsx";
import { SuiteTemplateFitFields } from "./suite-template-fit-fields.tsx";
import {
  type SuiteTemplateCreateRequest,
  type SuiteTemplateWizard,
  useSuiteTemplateWizard,
} from "./use-suite-template-wizard.ts";

export type SuiteTemplateGalleryDialogProps = {
  open: boolean;
  onClose: () => void;
  templates: SuiteTemplate[] | undefined;
  isLoading: boolean;
  loadFailed: boolean;
  onRetry: () => void;
  isCreating: boolean;
  onCreate: (request: SuiteTemplateCreateRequest) => void;
};

export const TEMPLATES_LOAD_FAILED = "Couldn't load the templates";

function BrowseStep({
  props,
  wizard,
}: {
  props: SuiteTemplateGalleryDialogProps;
  wizard: SuiteTemplateWizard;
}) {
  const tabItems = (["archetype", "red_team_pack"] as const).map((kind) => ({
    value: kind,
    label: TAB_LABELS[kind],
    testId: `suite-template-tab-${kind}`,
    content: (
      <TemplateCards templates={props.templates ?? []} kind={kind} onChoose={wizard.choose} />
    ),
  }));
  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title="New suite from a template"
      size="lg"
      error={
        props.loadFailed ? { title: TEMPLATES_LOAD_FAILED, onRetry: props.onRetry } : undefined
      }
      cancelLabel="Cancel"
      data-testid="suite-template-gallery"
    >
      {props.isLoading ? (
        <VStack align="stretch" gap={2} data-testid="suite-template-loading">
          <Skeleton height="72px" />
          <Skeleton height="72px" />
        </VStack>
      ) : (
        <ContentTabs
          label="Template kind"
          density="compact"
          value={wizard.tab}
          onValueChange={({ value }) => wizard.setTab(value)}
          items={tabItems}
        />
      )}
    </Dialog>
  );
}

export function SuiteTemplateGalleryDialog(props: SuiteTemplateGalleryDialogProps) {
  const wizard = useSuiteTemplateWizard(props);
  const { chosen } = wizard;

  if (wizard.step === "preview" && chosen) {
    return (
      <Dialog
        open={props.open}
        onClose={props.onClose}
        title={chosen.title}
        size="lg"
        secondaryAction={{ label: "Back", onClick: () => wizard.setStep("browse") }}
        primaryAction={{
          label: "Next",
          onClick: () => wizard.setStep("fit"),
          "data-testid": "suite-template-next",
        }}
        data-testid="suite-template-gallery"
      >
        <TemplatePreview template={chosen} />
      </Dialog>
    );
  }

  if (wizard.step === "fit" && chosen) {
    return (
      <Dialog
        open={props.open}
        onClose={props.onClose}
        title={`Fit ${chosen.title} to your agent`}
        size="md"
        busy={props.isCreating}
        onSubmit={wizard.submit}
        secondaryAction={{ label: "Back", onClick: () => wizard.setStep("preview") }}
        primaryAction={{
          label: "Create suite",
          type: "submit",
          loading: props.isCreating,
          "data-testid": "suite-template-create",
        }}
        data-testid="suite-template-gallery"
      >
        <SuiteTemplateFitFields template={chosen} wizard={wizard} />
      </Dialog>
    );
  }

  return <BrowseStep props={props} wizard={wizard} />;
}
