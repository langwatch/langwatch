import {
  Button,
  Field,
  HStack,
  IconButton,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus, Trash2 } from "lucide-react";
import { isReservedWebhookHeader } from "./shared";
import { newHeaderRow, type HeaderRow, type WebhookSlice } from "./slice";

/** The static-headers editor for a webhook automation: add/remove rows, mask
 *  kept secrets, and warn on reserved header names (ADR-040 §1/§3). */
export function HeadersEditor({
  slice,
  onChange,
}: {
  slice: WebhookSlice;
  onChange: (next: WebhookSlice) => void;
}) {
  const setRow = (index: number, row: HeaderRow) => {
    const headers = slice.headers.map((h, i) => (i === index ? row : h));
    onChange({ ...slice, headers });
  };
  const removeRow = (index: number) =>
    onChange({ ...slice, headers: slice.headers.filter((_, i) => i !== index) });

  return (
    <Field.Root>
      <Field.Label>Headers</Field.Label>
      <VStack align="stretch" gap={2} width="full">
        {slice.headers.map((row, index) => {
          const reserved =
            row.name.trim() !== "" && isReservedWebhookHeader(row.name);
          return (
            <VStack key={row.id} align="stretch" gap={1}>
              <HStack gap={2}>
                <Input
                  size="sm"
                  flex="1"
                  value={row.name}
                  placeholder="Authorization"
                  onChange={(e) =>
                    // The saved value is keyed by the old name server-side, so
                    // renaming a kept row means re-entering its value.
                    setRow(index, {
                      ...row,
                      name: e.target.value,
                      kept: false,
                    })
                  }
                />
                <Input
                  size="sm"
                  flex="2"
                  value={row.value}
                  placeholder={row.kept ? "•••••• (saved)" : "Bearer …"}
                  onChange={(e) =>
                    setRow(index, {
                      ...row,
                      value: e.target.value,
                      kept: false,
                    })
                  }
                />
                <IconButton
                  size="sm"
                  variant="ghost"
                  aria-label="Remove header"
                  onClick={() => removeRow(index)}
                >
                  <Trash2 size={14} />
                </IconButton>
              </HStack>
              {reserved ? (
                <Text textStyle="xs" color="fg.error">
                  This header is set by LangWatch and will be ignored.
                </Text>
              ) : null}
            </VStack>
          );
        })}
        <Button
          size="xs"
          variant="outline"
          width="fit-content"
          onClick={() =>
            onChange({
              ...slice,
              headers: [...slice.headers, newHeaderRow()],
            })
          }
        >
          <Plus size={13} /> Add header
        </Button>
      </VStack>
      <Field.HelperText>
        Sent with every request — for example an Authorization header your
        endpoint expects. Values are stored encrypted and never shown again.
      </Field.HelperText>
    </Field.Root>
  );
}
