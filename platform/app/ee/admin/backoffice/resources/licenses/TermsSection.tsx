import { Button } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { Section } from "./DrawerSection";
import { TermsFields } from "./TermsFields";
import { type TermsForm, termsFormFrom, termsPayload } from "./terms";
import type { License } from "./types";
import { useLicenseCommands } from "./useLicenseCommands";

export function TermsSection({ license }: { license: License }) {
  const commands = useLicenseCommands();
  const [terms, setTerms] = useState<TermsForm>(termsFormFrom(null));

  useEffect(() => {
    setTerms(termsFormFrom(license));
  }, [license]);

  return (
    <Section title="Entitlements and terms">
      <TermsFields form={terms} onChange={setTerms} />
      <Button
        size="sm"
        loading={commands.updateTerms.isPending}
        onClick={() =>
          commands.updateTerms.mutate({
            id: license.id,
            ...termsPayload(terms),
          })
        }
      >
        Save terms
      </Button>
    </Section>
  );
}
