/** Name the agent, sign with a passkey, then copy its requester key: shown here once only. */

import { Dialog } from "@langwatch/design-system/dialog";
import {
  Alert,
  Box,
  Button,
  Code,
  Field,
  HStack,
  Input,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { useCopyToClipboard } from "@langwatch/design-system/use-copy-to-clipboard";
import {
  STAFF_ACCESS_REQUESTER_NAME_MAX_LENGTH,
  type StaffAccessEnrolled,
} from "@langwatch/staff-access-contract";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { SETUP_COMMAND } from "../../model/staff-access-copy.ts";
import { PasskeyFailure } from "../elements/passkey-failure.tsx";

export function EnrolAgentDialog({
  open,
  onClose,
  enrolling,
  enrolAgent,
}: {
  open: boolean;
  onClose: () => void;
  enrolling: boolean;
  enrolAgent: (input: { name: string }) => Promise<StaffAccessEnrolled>;
}) {
  const [name, setName] = useState("");
  const [nameMissing, setNameMissing] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [enrolled, setEnrolled] = useState<StaffAccessEnrolled | null>(null);

  const close = () => {
    setName("");
    setNameMissing(false);
    setFailure(null);
    setEnrolled(null);
    onClose();
  };

  const submit = async () => {
    if (name.trim() === "") {
      setNameMissing(true);
      return;
    }
    setFailure(null);
    try {
      setEnrolled(await enrolAgent({ name: name.trim() }));
    } catch (error) {
      setFailure(error);
    }
  };

  if (enrolled) {
    return (
      <Dialog
        open={open}
        onClose={close}
        title={`${enrolled.requester.name} is enrolled`}
        size="md"
        // The key is shown once: only Done closes it, never a stray click or Escape.
        closeOnInteractOutside={false}
        closeOnEscape={false}
        cancelLabel={null}
        primaryAction={{ label: "Done", onClick: close, "data-testid": "staff-access-enrol-done" }}
      >
        <EnrolledKey requesterKey={enrolled.requesterKey} />
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Enrol an agent"
      description="Your agent gets a key that can only ask you for access. Each request still needs your passkey."
      size="md"
      busy={enrolling}
      onSubmit={() => void submit()}
      primaryAction={{
        type: "submit",
        label: "Continue with passkey",
        loading: enrolling,
        "data-testid": "staff-access-enrol-submit",
      }}
    >
      <VStack align="stretch" gap={4}>
        <Field.Root invalid={nameMissing}>
          <Field.Label>Agent name</Field.Label>
          <Input
            value={name}
            maxLength={STAFF_ACCESS_REQUESTER_NAME_MAX_LENGTH}
            placeholder="Laptop agent"
            data-testid="staff-access-enrol-name-input"
            onChange={(event) => {
              setName(event.target.value);
              setNameMissing(false);
            }}
          />
          <Field.HelperText>So you can tell your agents apart in the list.</Field.HelperText>
          <Field.ErrorText>Give the agent a name.</Field.ErrorText>
        </Field.Root>
        {failure !== null && <PasskeyFailure failure={failure} />}
      </VStack>
    </Dialog>
  );
}

function EnrolledKey({ requesterKey }: { requesterKey: string }) {
  return (
    <VStack align="stretch" gap={4}>
      <Alert.Root status="warning">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Copy it now</Alert.Title>
          <Alert.Description>
            This key is shown once. It lasts 90 days and can only ask for access, never use it.
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>
      <CopyLine label="Requester key" value={requesterKey} testId="staff-access-requester-key" />
      <CopyLine
        label="Copy the key, then run this on the machine your agent uses"
        value={SETUP_COMMAND}
        testId="staff-access-setup-command"
      />
      <Text textStyle="sm" color="fg.muted">
        Without a clipboard command, run langwatch ops setup and paste the key when it asks.
      </Text>
    </VStack>
  );
}

function CopyLine({ label, value, testId }: { label: string; value: string; testId: string }) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <VStack align="stretch" gap={1}>
      <Text textStyle="label">{label}</Text>
      <HStack gap={2} align="start">
        <Box flex={1} minWidth={0}>
          <Code
            data-testid={testId}
            display="block"
            whiteSpace="pre-wrap"
            wordBreak="break-all"
            padding={2}
          >
            {value}
          </Code>
        </Box>
        <Button
          size="sm"
          variant="outline"
          aria-label={`Copy ${label.toLowerCase()}`}
          data-testid={`${testId}-copy`}
          onClick={() => copy(value)}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </HStack>
    </VStack>
  );
}
