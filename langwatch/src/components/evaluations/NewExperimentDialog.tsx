import {
  Button,
  Dialog,
  Field,
  HStack,
  Input,
  Spinner,
} from "@chakra-ui/react";
import { nanoid } from "nanoid";
import { useRouter } from "next/router";
import { useState } from "react";
import { createInitialState } from "~/evaluations-v3/types";
import { extractPersistedState } from "~/evaluations-v3/types/persistence";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { slugify } from "~/utils/slugify";

export type NewExperimentDialogProps = {
  open: boolean;
  onOpenChange: (details: { open: boolean }) => void;
};

/**
 * Dialog for creating a new experiment with a name.
 * Creates the experiment with a slug (name + nanoid) and redirects to the v3 page.
 */
export function NewExperimentDialog({
  open,
  onOpenChange,
}: NewExperimentDialogProps) {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const [name, setName] = useState("");

  const createExperiment = api.experiments.saveEvaluationsV3.useMutation({
    onSuccess: (data) => {
      // Redirect to the new experiment page
      void router.push(`/${project?.slug}/evaluations/v3/${data.slug}`);
      onOpenChange({ open: false });
      setName("");
    },
  });

  const handleCreate = () => {
    if (!project?.id || !name.trim()) return;

    // Generate slug from name + nanoid suffix
    const baseSlug = slugify(name.trim());
    const slug = baseSlug ? `${baseSlug}-${nanoid(5)}` : nanoid(5);

    // Create initial state with the user's name
    const initialState = createInitialState();
    initialState.name = name.trim();

    // Extract persisted state for saving
    const persistedState = extractPersistedState(initialState);

    createExperiment.mutate({
      projectId: project.id,
      experimentId: undefined, // New experiment
      state: {
        ...persistedState,
        experimentSlug: slug, // Include slug in state so backend uses it
      } as Parameters<typeof createExperiment.mutate>[0]["state"],
    });
  };

  const handleClose = () => {
    onOpenChange({ open: false });
    setName("");
  };

  const canCreate = !!name.trim() && !createExperiment.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Backdrop />
      <Dialog.Positioner>
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>New Experiment</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Field.Root>
              <Field.Label>Experiment Name</Field.Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter experiment name"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canCreate) {
                    handleCreate();
                  }
                }}
                autoFocus
              />
              <Field.HelperText>
                Give your experiment a descriptive name
              </Field.HelperText>
            </Field.Root>
          </Dialog.Body>
          <Dialog.Footer>
            <HStack gap={3}>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                colorScheme="blue"
                onClick={handleCreate}
                disabled={!canCreate}
              >
                {createExperiment.isPending && <Spinner size="sm" marginRight={2} />}
                Create
              </Button>
            </HStack>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  );
}
