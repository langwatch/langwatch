import {
  Badge,
  Button,
  Code,
  ConfirmButton,
  CopyButton,
  Inline,
  Input,
  Panel,
  Section,
  Stack,
  Table,
  Text,
  type TableColumn,
} from "@langwatch/design-system-internal";
import { useState, type FormEvent } from "react";

import {
  emptySchema,
  recordSchema,
  tenantPath,
  type PublishedRecord,
  type TenantView,
} from "../api.ts";
import { RefusalCallout } from "../refusal-callout.tsx";
import { useAct } from "../use-act.ts";

/**
 * The DNS registry: this machine standing in for the registrar a reserved name
 * like acme.test has none of. The fields are LangWatch's own, in its order and
 * words, because the form is filled in by copying that panel row by row.
 */
export const DomainTab = ({ tenant, reload }: { tenant: TenantView; reload: () => void }) => {
  const { act, busy, refusal } = useAct({ onDone: reload });
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const base = tenantPath({ id: tenant.id });

  const publish = async (event: FormEvent) => {
    event.preventDefault();
    const record = await act({
      name: "publish",
      path: `${base}/dns`,
      method: "POST",
      body: { name, value },
      schema: recordSchema,
    });
    if (record === undefined) return;
    setName("");
    setValue("");
  };
  const remove = (record: PublishedRecord) =>
    void act({
      name: `remove-${record.name}`,
      path: `${base}/dns/${encodeURIComponent(record.name)}`,
      method: "DELETE",
      schema: emptySchema,
    });

  const columns: TableColumn<PublishedRecord>[] = [
    { key: "name", header: "TXT record", cell: (record) => record.name, mono: true },
    {
      key: "value",
      header: "Value",
      cell: (record) => (
        <Inline gap={2} className="idp-copyable">
          <Text mono truncate title={record.value}>
            {record.value}
          </Text>
          <CopyButton value={record.value} label="Copy value" />
        </Inline>
      ),
      width: "30%",
      hideOnNarrow: true,
    },
    {
      key: "answers",
      header: "Answers",
      cell: (record) =>
        record.verifies ? (
          <Badge tone="ok">a LangWatch check</Badge>
        ) : (
          <Text tone="muted" truncate title="Seeded at the bare domain, which no verifier asks for">
            nothing yet
          </Text>
        ),
      width: "200px",
    },
    {
      key: "remove",
      header: "",
      cell: (record) => <ConfirmButton label="Remove" size="sm" onConfirm={() => remove(record)} />,
      align: "end",
      width: "112px",
    },
  ];

  return (
    <Stack gap={8}>
      <Panel
        title="Publish a domain proof"
        meta={tenant.dnsAddr === "" ? "HTTP only" : `DNS on ${tenant.dnsAddr}`}
      >
        <form onSubmit={(event) => void publish(event)}>
          <Stack gap={4}>
            <Text tone="secondary">
              Paste the value LangWatch showed you and it is published where the check will look.
              One press publishes both channels: the TXT record at{" "}
              <Code>{`_langwatch-verification.${tenant.domain}`}</Code> and the same value as the
              well-known file, so whichever one the check asks for, it finds.
            </Text>
            <Input
              label="Name"
              placeholder={`_langwatch-verification.${tenant.domain}`}
              hint="The type is always TXT. A bare domain works too; the label is added."
              mono
              required
              value={name}
              onChange={setName}
            />
            <Input
              label="Value"
              placeholder="the value LangWatch showed you once"
              mono
              required
              autoComplete="off"
              value={value}
              onChange={setValue}
            />
            <RefusalCallout refusal={refusal} />
            <div>
              <Button variant="primary" type="submit" loading={busy === "publish"}>
                Publish the record
              </Button>
            </div>
          </Stack>
        </form>
      </Panel>
      <Section
        title="Published"
        description="Removing a record is how you watch a proof lapse: the checker stops finding it, exactly as if somebody deleted it at the registrar."
      >
        <Panel>
          <Table
            columns={columns}
            rows={tenant.records}
            rowKey={(record) => record.name}
            caption={`TXT records for ${tenant.domain}`}
            empty={`Nothing is published for ${tenant.domain} yet.`}
          />
        </Panel>
      </Section>
    </Stack>
  );
};
