import { VStack } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { Drawer } from "~/components/ui/drawer";
import {
  CustomerField,
  IssueLicenseFields,
  IssueModeField,
  RegisterLicenseFields,
} from "./IssueDrawerFields";
import { IssueDrawerFooter } from "./IssueDrawerFooter";
import { useIssueCommands, useIssueForm } from "./issueForm";
import { SignedLicenseOnce } from "./SignedLicenseOnce";

export function IssueDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { form, set, reset } = useIssueForm();
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const commands = useIssueCommands({
    onIssued: setIssuedKey,
    onRegistered: onClose,
  });

  useEffect(() => {
    if (!open) return;
    reset();
    setIssuedKey(null);
  }, [open, reset]);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={({ open: next }) => {
        if (!next) onClose();
      }}
      size="lg"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>New license</Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body>
          <VStack align="start" gap={4} width="full">
            <IssueModeField form={form} set={set} />
            <CustomerField form={form} set={set} />
            {form.mode === "register" ? (
              <RegisterLicenseFields form={form} set={set} />
            ) : (
              <IssueLicenseFields form={form} set={set} />
            )}
            {issuedKey ? <SignedLicenseOnce licenseKey={issuedKey} /> : null}
          </VStack>
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <IssueDrawerFooter
            form={form}
            issuedKey={issuedKey}
            commands={commands}
            onClose={onClose}
          />
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
