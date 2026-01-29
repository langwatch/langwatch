import { useRef, useState, useCallback } from "react";
import { Button, Heading } from "@chakra-ui/react";
import { Drawer } from "~/components/ui/drawer";
import { LicenseGeneratorForm, type LicenseGeneratorFormRef } from "./LicenseGeneratorForm";

interface LicenseGeneratorDrawerProps {
  open: boolean;
  onClose: () => void;
  organizationId: string;
}

export function LicenseGeneratorDrawer({
  open,
  onClose,
  organizationId,
}: LicenseGeneratorDrawerProps) {
  const formRef = useRef<LicenseGeneratorFormRef>(null);
  const [hasGeneratedLicense, setHasGeneratedLicense] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFormValid, setIsFormValid] = useState(false);

  const handleGenerate = () => {
    formRef.current?.handleGenerate();
  };

  const handleFormStateChange = useCallback((state: { isGenerating: boolean; isFormValid: boolean }) => {
    setIsGenerating(state.isGenerating);
    setIsFormValid(state.isFormValid);
  }, []);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={({ open }) => !open && onClose()}
      size="lg"
      closeOnInteractOutside={true}
      modal={false}
    >
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <Heading>Generate License</Heading>
        </Drawer.Header>
        <Drawer.Body padding={0}>
          <LicenseGeneratorForm
            ref={formRef}
            organizationId={organizationId}
            onGeneratedLicenseChange={setHasGeneratedLicense}
            onFormStateChange={handleFormStateChange}
          />
        </Drawer.Body>
        {!hasGeneratedLicense && (
          <Drawer.Footer borderTopWidth="1px" borderColor="border" justifyContent="flex-end">
            <Button
              colorPalette="blue"
              onClick={handleGenerate}
              loading={isGenerating}
              disabled={!isFormValid || isGenerating}
            >
              Generate License
            </Button>
          </Drawer.Footer>
        )}
      </Drawer.Content>
    </Drawer.Root>
  );
}
