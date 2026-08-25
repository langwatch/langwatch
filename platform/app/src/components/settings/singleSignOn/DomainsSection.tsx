import {
  Alert,
  Button,
  Heading,
  HStack,
  Input,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import type {
  SelfServeDomainClaimView,
  SelfServeSetupView,
} from "@langwatch/identity-server";
import { useState } from "react";
import { domainProofChipFor } from "~/features/sso/logic/domainProofChip";
import { api } from "../../../utils/api";
import { IdentityChip } from "../../access/IdentityRow";
import { CopyInput } from "../../CopyInput";
import { reportRefusal } from "./refusals";

/**
 * The domains this connection may carry, and where each one's evidence
 * stands (D05 tier 3, ADR-123).
 *
 * The chip table is SHARED with the access panel, so the two surfaces cannot
 * say different things about one domain. The case that matters most is a
 * domain whose published record has vanished: it is still in
 * `verifiedDomains`, because it still routes the people already here, and a
 * chip reading "Proved" would be technically true and completely wrong.
 */
export function DomainsSection({
  claims,
  connection,
  record,
  canManage,
  organizationId,
  connectionId,
  provesWithLicense,
}: {
  claims: SelfServeDomainClaimView[];
  connection: NonNullable<SelfServeSetupView["connection"]>;
  record: SelfServeSetupView["record"];
  canManage: boolean;
  organizationId: string;
  connectionId: string;
  provesWithLicense: boolean;
}) {
  const [domain, setDomain] = useState("");
  const claim = api.ssoSetup.claimDomain.useMutation();
  const prove = api.ssoSetup.proveDomain.useMutation();
  const utils = api.useUtils();

  const proved = new Set(connection.verifiedDomains);
  const proofByDomain = new Map(
    connection.domainProofs.map((proof) => [proof.domain, proof]),
  );
  // The union of claimed and proved: a domain that is proved but whose claim
  // row has moved on is still routing, and a list that dropped it would hide
  // the one thing a reader most needs to see when its record goes missing.
  const domains = [
    ...claims.map((entry) => entry.domain),
    ...connection.verifiedDomains.filter(
      (entry) => !claims.some((candidate) => candidate.domain === entry),
    ),
  ];

  return (
    <VStack align="stretch" gap={3}>
      {domains.length === 0 ? (
        <Text color="fg.muted">No domain has been claimed yet.</Text>
      ) : (
        <Table.Root size="sm">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Domain</Table.ColumnHeader>
              <Table.ColumnHeader>Status</Table.ColumnHeader>
              <Table.ColumnHeader />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {domains.map((entry) => {
              const claimed = claims.find(
                (candidate) => candidate.domain === entry,
              );
              const chip = domainProofChipFor({
                proved: proved.has(entry),
                proofState: proofByDomain.get(entry)?.proofState ?? "VERIFIED",
                graceEndsAtMs: proofByDomain.get(entry)?.graceEndsAtMs ?? null,
                claim: claimed,
              });
              return (
                <Table.Row key={entry}>
                  <Table.Cell>{entry}</Table.Cell>
                  <Table.Cell>
                    <VStack align="start" gap={1}>
                      <IdentityChip
                        label={chip.label}
                        tone={chip.tone}
                        title={chip.title}
                      />
                      {/* The reviewer's own words, read back so a second
                          attempt starts from what a human already said. */}
                      {claimed?.note && (
                        <Text fontSize="sm" color="fg.muted">
                          {claimed.note}
                        </Text>
                      )}
                    </VStack>
                  </Table.Cell>
                  <Table.Cell>
                    {canManage && claimed?.state === "APPROVED" && (
                      <Button
                        size="xs"
                        loading={prove.isPending}
                        onClick={() =>
                          prove.mutate(
                            { organizationId, connectionId, domain: entry },
                            {
                              onSuccess: () =>
                                void utils.ssoSetup.getSetup.invalidate(),
                              onError: reportRefusal,
                            },
                          )
                        }
                      >
                        {provesWithLicense
                          ? "Prove with our licence"
                          : "Get the record to publish"}
                      </Button>
                    )}
                    {/* A rejected claim can be made again, without
                        registering a second connection. */}
                    {canManage && claimed?.state === "REJECTED" && (
                      <Button
                        size="xs"
                        variant="outline"
                        loading={claim.isPending}
                        onClick={() =>
                          claim.mutate(
                            { organizationId, connectionId, domain: entry },
                            {
                              onSuccess: () =>
                                void utils.ssoSetup.getSetup.invalidate(),
                              onError: reportRefusal,
                            },
                          )
                        }
                      >
                        Claim it again
                      </Button>
                    )}
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      )}

      {canManage && (
        <HStack>
          <Input
            placeholder="Domain, for example acme.com"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
          />
          <Button
            loading={claim.isPending}
            onClick={() =>
              claim.mutate(
                { organizationId, connectionId, domain },
                {
                  onSuccess: () => {
                    setDomain("");
                    void utils.ssoSetup.getSetup.invalidate();
                  },
                  onError: reportRefusal,
                },
              )
            }
          >
            Claim domain
          </Button>
        </HStack>
      )}

      {record !== null && (
        <PublishedRecord
          record={record}
          canManage={canManage}
          organizationId={organizationId}
          connectionId={connectionId}
        />
      )}
    </VStack>
  );
}

function PublishedRecord({
  record,
  canManage,
  organizationId,
  connectionId,
}: {
  record: NonNullable<SelfServeSetupView["record"]>;
  canManage: boolean;
  organizationId: string;
  connectionId: string;
}) {
  const check = api.ssoSetup.checkDomainRecord.useMutation();
  const prove = api.ssoSetup.proveDomain.useMutation();
  const utils = api.useUtils();

  return (
    <VStack align="stretch" gap={3} paddingTop={2}>
      <Heading size="xs">Publish this record on {record.domain}</Heading>
      <Text color="fg.muted">
        Add it wherever you manage DNS for {record.domain}. Some providers ask
        for the whole name and some ask for the part before your domain, so both
        are here.
      </Text>
      <CopyInput value={record.type} label="Record type" />
      <CopyInput value={record.name} label="Record name" />
      <CopyInput
        value={record.label}
        label="Record name, without your domain"
      />
      {/* The value is shown once, when it is issued. What is kept is its
          hash, so a reload shows the record rather than the secret. */}
      {record.value === null ? (
        <Text color="fg.muted">
          The value was shown once, when the record was issued. If you no longer
          have it, ask for a fresh record below.
        </Text>
      ) : (
        <CopyInput value={record.value} label="Record value" />
      )}
      {record.expired && (
        <Alert.Root status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>That record has expired</Alert.Title>
            <Alert.Description>
              Ask for a fresh one and publish it. Your approved domain is
              unaffected, and you don&apos;t start over.
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}
      {canManage && (
        <HStack>
          <Button
            loading={check.isPending}
            onClick={() =>
              check.mutate(
                { organizationId, connectionId, domain: record.domain },
                {
                  onSuccess: () => void utils.ssoSetup.getSetup.invalidate(),
                  onError: reportRefusal,
                },
              )
            }
          >
            Check for it now
          </Button>
          <Button
            variant="outline"
            loading={prove.isPending}
            onClick={() =>
              prove.mutate(
                { organizationId, connectionId, domain: record.domain },
                {
                  onSuccess: () => void utils.ssoSetup.getSetup.invalidate(),
                  onError: reportRefusal,
                },
              )
            }
          >
            Give me a fresh record
          </Button>
        </HStack>
      )}
    </VStack>
  );
}
