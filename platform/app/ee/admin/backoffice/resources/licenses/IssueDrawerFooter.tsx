import { Button, HStack } from "@chakra-ui/react";
import { dateInputToISO } from "../../BackofficeTable";
import type { IssueForm, useIssueCommands } from "./issueForm";
import { termsPayload } from "./terms";

type IssueCommands = ReturnType<typeof useIssueCommands>;

export function IssueDrawerFooter({
  form,
  issuedKey,
  commands,
  onClose,
}: {
  form: IssueForm;
  issuedKey: string | null;
  commands: IssueCommands;
  onClose: () => void;
}) {
  return (
    <HStack gap={3}>
      <Button variant="outline" onClick={onClose}>
        {issuedKey ? "Done" : "Cancel"}
      </Button>
      {issuedKey ? null : form.mode === "register" ? (
        <RegisterButton form={form} register={commands.register} />
      ) : (
        <IssueButton form={form} issue={commands.issue} />
      )}
    </HStack>
  );
}

function RegisterButton({
  form,
  register,
}: {
  form: IssueForm;
  register: IssueCommands["register"];
}) {
  return (
    <Button
      colorPalette="blue"
      disabled={
        form.licenseKey.trim() === "" || form.organizationId.trim() === ""
      }
      loading={register.isPending}
      onClick={() =>
        register.mutate({
          licenseKey: form.licenseKey.trim(),
          organizationId: form.organizationId.trim(),
        })
      }
    >
      Register license
    </Button>
  );
}

function IssueButton({
  form,
  issue,
}: {
  form: IssueForm;
  issue: IssueCommands["issue"];
}) {
  const customer =
    form.customerMode === "existing"
      ? { organizationId: form.organizationId.trim() }
      : { newOrganizationName: form.newOrganizationName.trim() };
  const customerValid =
    form.customerMode === "existing"
      ? form.organizationId.trim() !== ""
      : form.newOrganizationName.trim() !== "";

  return (
    <Button
      colorPalette="blue"
      disabled={
        !customerValid ||
        form.email.trim() === "" ||
        form.expiresAt === "" ||
        Number(form.maxMembers) < 1
      }
      loading={issue.isPending}
      onClick={() => {
        const iso = dateInputToISO(form.expiresAt);
        if (!iso) return;
        issue.mutate({
          customer,
          email: form.email.trim(),
          planType: form.planType,
          maxMembers: Number(form.maxMembers),
          maxMembersLite:
            form.maxMembersLite.trim() === ""
              ? undefined
              : Number(form.maxMembersLite),
          expiresAt: new Date(iso),
          terms: termsPayload(form.terms),
        });
      }}
    >
      Issue license
    </Button>
  );
}
