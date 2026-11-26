/**
 * "New dashboard": a name, the product it lives in and who can see it, then the board is made
 * and opened. The library offers a Product select and, under Project, the project; a product's
 * "+" fixes the product. Mounted while open, so each opening starts from fresh defaults.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import {
  DASHBOARD_HOME_PRODUCTS,
  type DashboardHomeProduct,
  type DashboardProject,
  type DashboardScope,
  homeAllowsScope,
} from "@langwatch/dashboard-contract";
import { Dialog } from "@langwatch/design-system/dialog";
import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Radio, RadioGroup } from "@langwatch/design-system/radio";
import { ScopeChipPicker } from "@langwatch/design-system/scope-chip-picker";
import { type ReactNode, useState } from "react";

import {
  DEFAULT_SCOPE_BY_PRODUCT,
  firstUntitledName,
  HOME_PRODUCT_LABELS,
} from "../../model/organization-library.ts";

/** One choice of who can see the new board. */
type SharingChoice = { scope: DashboardScope; title: string; hint: string };

/** Project only where the home allows it (LLM Ops); the other scopes need `mayShare`. */
function sharingChoices({
  product,
  projectName,
  organizationName,
  mayShare,
}: {
  product: DashboardHomeProduct;
  projectName: string;
  organizationName: string;
  mayShare: boolean;
}): SharingChoice[] {
  const project: SharingChoice[] = homeAllowsScope({ homeProduct: product, scope: "PROJECT" })
    ? [{ scope: "PROJECT", title: "Project", hint: `Everyone in ${projectName}` }]
    : [];
  // Another scope asks analytics:update too, so a seat without it is offered Project alone.
  if (!mayShare) return project;
  return [
    ...project,
    { scope: "ORGANIZATION", title: "Organization", hint: `Everyone in ${organizationName}` },
    { scope: "PRIVATE", title: "Only me", hint: "You can share it later" },
  ];
}

/**
 * Whether the member is offered any scope for a board homed in `product`: Project where the
 * home allows it, the others with `mayShare`. A product with none offers no create at all.
 */
export function hasSharingChoice({
  product,
  mayShare,
}: {
  product: DashboardHomeProduct;
  mayShare: boolean;
}): boolean {
  return mayShare || homeAllowsScope({ homeProduct: product, scope: "PROJECT" });
}

/** The product's own default where it is offered, else the first scope offered. */
function defaultScope({
  choices,
  product,
}: {
  choices: readonly SharingChoice[];
  product: DashboardHomeProduct;
}) {
  const preferred = DEFAULT_SCOPE_BY_PRODUCT[product];
  return choices.some((choice) => choice.scope === preferred)
    ? preferred
    : (choices[0]?.scope ?? preferred);
}

function NameField({ name, onName }: { name: string; onName: (name: string) => void }) {
  return (
    <Field.Root invalid={!name.trim()}>
      <Field.Label>Name</Field.Label>
      {/* The dialog focuses its first field, so the name opens selected. */}
      <Input
        value={name}
        onChange={(event) => onName(event.target.value)}
        onFocus={(event) => event.target.select()}
      />
      <Field.ErrorText>Give the dashboard a name.</Field.ErrorText>
    </Field.Root>
  );
}

/** The products a member can make a board in: those offering at least one scope. */
function ProductField({
  product,
  products,
  onProduct,
}: {
  product: DashboardHomeProduct;
  products: readonly DashboardHomeProduct[];
  onProduct: (product: DashboardHomeProduct) => void;
}) {
  return (
    <Field.Root>
      <Field.Label>Product</Field.Label>
      <NativeSelect.Root size="sm">
        <NativeSelect.Field
          value={product}
          onChange={(event) => {
            const picked = products.find((candidate) => candidate === event.target.value);
            if (picked) onProduct(picked);
          }}
        >
          {products.map((candidate) => (
            <option key={candidate} value={candidate}>
              {HOME_PRODUCT_LABELS[candidate]}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </Field.Root>
  );
}

/** Which project a Project board is kept in, under the Project choice. */
function ProjectPicker({
  projects,
  picked,
  onPick,
}: {
  projects: readonly DashboardProject[];
  picked: DashboardProject;
  onPick: (project: DashboardProject) => void;
}) {
  return (
    <Box paddingLeft={6} width="full" data-testid="new-dashboard-project">
      <ScopeChipPicker<"PROJECT">
        value={[{ scopeType: "PROJECT", scopeId: picked.id }]}
        onChange={(next) => {
          const project = projects.find(({ id }) => id === next[0]?.scopeId);
          if (project) onPick(project);
        }}
        organizationId={void 0}
        availableProjects={projects.map(({ id, name }) => ({ id, name }))}
        allowedScopeTypes={["PROJECT"]}
        variant="single-select"
        size="sm"
        singleSelect
        label=""
        showSummary={false}
      />
    </Box>
  );
}

/** Who can see the new board: its project, the whole organization, or only its maker. */
function SharingFieldset({
  scope,
  onScope,
  choices,
  underProject,
}: {
  scope: DashboardScope;
  onScope: (scope: DashboardScope) => void;
  choices: readonly SharingChoice[];
  /** Drawn under the Project choice while it is picked. */
  underProject?: ReactNode;
}) {
  return (
    <VStack as="fieldset" align="stretch" gap={1.5}>
      <Text as="legend" textStyle="caption" fontWeight="medium" color="fg.muted">
        Who can see it
      </Text>
      <RadioGroup
        value={scope}
        onValueChange={(details: { value: string | null }) => {
          const picked = choices.find((choice) => choice.scope === details.value);
          if (picked) onScope(picked.scope);
        }}
      >
        <VStack align="stretch" gap={2}>
          {choices.map((choice) => (
            <VStack key={choice.scope} align="stretch" gap={1.5}>
              <Radio value={choice.scope}>
                <VStack align="start" gap={0}>
                  <Text textStyle="bodySm" fontWeight="medium">
                    {choice.title}
                  </Text>
                  <Text textStyle="caption" color="fg.muted">
                    {choice.hint}
                  </Text>
                </VStack>
              </Radio>
              {choice.scope === "PROJECT" && scope === "PROJECT" && underProject}
            </VStack>
          ))}
        </VStack>
      </RadioGroup>
    </VStack>
  );
}

/** Where the board lives, and where it is stored when its scope does not already say so. */
function PlacementNote({
  product,
  scope,
  projectName,
}: {
  product: DashboardHomeProduct;
  scope: DashboardScope;
  projectName: string;
}) {
  // A Project board names its project, and an Only me board in Coding agents is personal.
  const namesStore = product !== "llm-ops" && !(product === "me" && scope === "PRIVATE");
  return (
    <VStack align="start" gap={0.5}>
      <Text textStyle="caption" color="fg.subtle">
        Lives in {HOME_PRODUCT_LABELS[product]}. Move it from Dashboards.
      </Text>
      {namesStore && (
        <Text textStyle="caption" color="fg.subtle">
          Stored in {projectName}.
        </Text>
      )}
    </VStack>
  );
}

export function NewDashboardDialog({
  product: fixedProduct,
  takenNamesIn,
  projectName,
  organizationName,
  mayShare,
  projectChoice,
  isCreating,
  onCreate,
  onClose,
}: {
  /** The product it is made in, from that product's "+"; unset in the library, which asks. */
  product?: DashboardHomeProduct;
  /** The names boards homed in a product already have, so a new one is numbered past them. */
  takenNamesIn: (product: DashboardHomeProduct) => readonly string[];
  /** The store project, where the board is kept. */
  projectName: string;
  organizationName: string;
  /** Whether the member may make it Only me or Organization there too. */
  mayShare: boolean;
  /** At the organization level, the projects a Project board may be kept in, offered under it. */
  projectChoice?: { projects: readonly DashboardProject[]; initial: DashboardProject };
  isCreating: boolean;
  /** Makes the board, in `project` where one was picked; true once made, which closes it. */
  onCreate: (input: {
    name: string;
    scope: DashboardScope;
    homeProduct: DashboardHomeProduct;
    project?: DashboardProject;
  }) => Promise<boolean>;
  onClose: () => void;
}) {
  const [pickedProject, setPickedProject] = useState(projectChoice?.initial);
  const form = useNewDashboardForm({
    fixedProduct,
    takenNamesIn,
    projectName: pickedProject?.name ?? projectName,
    organizationName,
    mayShare,
  });
  const { home, name, scope } = form;
  const inProject = scope === "PROJECT" && pickedProject ? { project: pickedProject } : {};

  const submit = async () => {
    if (isCreating || !form.canCreate) return;
    if (await onCreate({ name: name.trim(), scope, homeProduct: home, ...inProject })) onClose();
  };

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      title="New dashboard"
      busy={isCreating}
      showCloseButton={false}
      onSubmit={() => void submit()}
      footerContent={
        <CreateFooter isCreating={isCreating} canCreate={form.canCreate} onCancel={onClose} />
      }
    >
      <VStack align="stretch" gap={4}>
        <NameField name={name} onName={form.setName} />
        {fixedProduct === void 0 && (
          <ProductField product={home} products={form.products} onProduct={form.pickProduct} />
        )}
        <SharingFieldset
          scope={scope}
          onScope={form.setScope}
          choices={form.choices}
          underProject={
            projectChoice &&
            pickedProject && (
              <ProjectPicker
                projects={projectChoice.projects}
                picked={pickedProject}
                onPick={setPickedProject}
              />
            )
          }
        />
        <PlacementNote product={home} scope={scope} projectName={projectName} />
      </VStack>
    </Dialog>
  );
}

/**
 * The dialog's name, product and scope: a product change resets the scope to that product's
 * default, and a name left as suggested follows the product's own numbering.
 */
function useNewDashboardForm({
  fixedProduct,
  takenNamesIn,
  projectName,
  organizationName,
  mayShare,
}: {
  fixedProduct: DashboardHomeProduct | undefined;
  takenNamesIn: (product: DashboardHomeProduct) => readonly string[];
  projectName: string;
  organizationName: string;
  mayShare: boolean;
}) {
  const choicesIn = (product: DashboardHomeProduct) =>
    sharingChoices({ product, projectName, organizationName, mayShare });
  const products = DASHBOARD_HOME_PRODUCTS.filter((product) =>
    hasSharingChoice({ product, mayShare }),
  );
  const [home, setHome] = useState<DashboardHomeProduct>(fixedProduct ?? "llm-ops");
  const [name, setName] = useState(() => firstUntitledName(takenNamesIn(home)));
  const [scope, setScope] = useState<DashboardScope>(() =>
    defaultScope({ choices: choicesIn(home), product: home }),
  );
  const choices = choicesIn(home);
  const canCreate = name.trim() !== "" && choices.some((choice) => choice.scope === scope);

  const pickProduct = (next: DashboardHomeProduct) => {
    if (name === firstUntitledName(takenNamesIn(home))) {
      setName(firstUntitledName(takenNamesIn(next)));
    }
    setHome(next);
    setScope(defaultScope({ choices: choicesIn(next), product: next }));
  };

  return { home, name, setName, scope, setScope, choices, products, canCreate, pickProduct };
}

/** The approved design's teal Create, which the frame's accent primary cannot paint. */
function CreateFooter({
  isCreating,
  canCreate,
  onCancel,
}: {
  isCreating: boolean;
  canCreate: boolean;
  onCancel: () => void;
}) {
  return (
    <HStack justify="flex-end" gap={2} width="full">
      <Button size="sm" variant="ghost" disabled={isCreating} onClick={onCancel}>
        Cancel
      </Button>
      <Button
        size="sm"
        type="submit"
        colorPalette="teal"
        disabled={!canCreate}
        loading={isCreating}
      >
        Create
      </Button>
    </HStack>
  );
}
