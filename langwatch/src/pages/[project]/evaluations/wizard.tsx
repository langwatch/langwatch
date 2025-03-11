import { useDisclosure } from "@chakra-ui/react";
import { useEffect } from "react";
import { EvaluationWizard } from "../../../components/evaluations/wizard/EvaluationWizard";
import { Dialog } from "../../../components/ui/dialog";
import EvaluationsV2 from "../evaluations_v2";
import { useRouter } from "next/router";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";

export default function EvaluationWizardNew() {
  const { open, setOpen } = useDisclosure();
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  useEffect(() => {
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <EvaluationsV2 />
      <Dialog.Root
        open={open}
        onOpenChange={({ open }) => {
          if (!open) {
            void router.push(`/${project?.slug}/evaluations_v2`);
          }
        }}
        size="full"
      >
        <EvaluationWizard />
      </Dialog.Root>
    </>
  );
}
