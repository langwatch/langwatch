// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The domains this connection may carry, and where each one's evidence
 * stands (D05 tier 3, ADR-123). A chip is a label, so every row also says
 * what happens next — including the states whose answer is "wait". A domain
 * whose published record has vanished still routes the people already here,
 * so it is never shown as simply "Proved".
 */
import { Button, HStack, Input, Table, Text, VStack } from "@chakra-ui/react";
import type { SsoIssuedDnsRecord } from "@langwatch/enterprise-sso-contract";
import { useEffect, useState } from "react";

import { ssoApi } from "../../behavior/sso-api.ts";
import { useSettlingSetup } from "../../behavior/use-settling-setup.ts";
import { domainNextStepFor } from "../../model/domain-next-step.ts";
import { domainProofChipFor } from "../../model/domain-proof-chip.ts";
import {
  domainRowsFor,
  type DomainClaimView,
  type DomainEvidenceView,
  type DomainRow,
} from "../../model/domain-rows.ts";
import {
  pendingDomainSettled,
  PENDING_DOMAIN_WORDS,
  type PendingDomainChange,
} from "../../model/pending-domain-change.ts";
import { CopyValueRow } from "../elements/copy-value-row.tsx";
import { DomainStatusChip } from "../elements/domain-status-chip.tsx";
import { InlineRefusal } from "../elements/refusals.tsx";
import { SettingsCard } from "../elements/settings-card.tsx";
import { SettingsTable } from "../elements/settings-table.tsx";

export function DomainsSection({
  organizationId,
  connectionId,
  canManage,
  provesWithLicense,
  evidence,
  claims,
  onChanged,
}: {
  organizationId: string;
  connectionId: string;
  canManage: boolean;
  /** A licensed installation proves with its licence, with nothing to publish. */
  provesWithLicense: boolean;
  evidence: readonly DomainEvidenceView[];
  claims: readonly DomainClaimView[];
  /** The setup read this section changed, so the screen can read it again. */
  onChanged?: () => void;
}) {
  const [domain, setDomain] = useState("");
  // Issued once and never returned again: a caller that does not catch the
  // value has thrown the ceremony's answer away, and pressing "prove" a
  // second time replaces the record anybody has already published.
  const [minted, setMinted] = useState<SsoIssuedDnsRecord | null>(null);
  // A command the server accepted whose projection has not arrived. The row
  // is unchanged until it does, so the page says so and reads again.
  const [pending, setPending] = useState<PendingDomainChange | null>(null);
  const claim = ssoApi.ssoSetup.claimDomain.useMutation();
  const rows = domainRowsFor({ evidence, claims });

  useSettlingSetup({ organizationId, waiting: pending !== null });

  useEffect(() => {
    if (!pending || !pendingDomainSettled({ pending, rows })) return;
    setPending(null);
    // The value is issued once: it stays on screen until the domain it
    // proves actually reads as proved.
    if (pending.kind === "proof") setMinted(null);
  }, [pending, rows]);

  const claimDomain = () => {
    claim.mutate(
      { organizationId, connectionId, domain: domain.trim() },
      {
        onSuccess: () => {
          setDomain("");
          onChanged?.();
        },
      },
    );
  };

  return (
    <SettingsCard
      title="Domains"
      hint="The email domains this connection decides sign-in for."
      testId="connection-domains"
    >
      <WhyADomainIsProved provesWithLicense={provesWithLicense} />

      {rows.length === 0 ? (
        <Text color="fg.muted" fontSize="sm">
          No domain has been claimed yet. Add the domain your team&apos;s email addresses end in —{" "}
          <Text as="span" fontFamily="mono">
            acme.com
          </Text>{" "}
          for somebody signing in as{" "}
          <Text as="span" fontFamily="mono">
            jane@acme.com
          </Text>
          .
        </Text>
      ) : (
        <SettingsTable testId="connection-domains-table">
          <Table.Header>
            <Table.Row background="transparent">
              <Table.ColumnHeader>Domain</Table.ColumnHeader>
              <Table.ColumnHeader>Status</Table.ColumnHeader>
              <Table.ColumnHeader />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((row) => (
              <DomainTableRow
                key={row.domain}
                row={row}
                canManage={canManage}
                organizationId={organizationId}
                connectionId={connectionId}
                provesWithLicense={provesWithLicense}
                // Either source: a value minted a moment ago is issued
                // whether or not the read has caught up, which is what moves
                // the row off "Prove this domain".
                recordIssued={minted?.domain === row.domain}
                onMinted={setMinted}
                onChanged={onChanged}
                onRemovalAccepted={() => setPending({ domain: row.domain, kind: "removal" })}
              />
            ))}
          </Table.Body>
        </SettingsTable>
      )}

      {canManage && (
        <HStack align="center">
          <Input
            placeholder="Domain, for example acme.com"
            aria-label="Domain"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
          />
          {/* An empty field is a question the server does not need to be
              asked: it comes back as the generic refusal, which reads as a
              rejection of the domain rather than of the empty box. */}
          <Button
            flexShrink={0}
            loading={claim.isPending}
            disabled={domain.trim().length === 0}
            onClick={claimDomain}
          >
            Claim domain
          </Button>
        </HStack>
      )}

      {canManage && <InlineRefusal error={claim.error} what="Claiming that domain" />}

      {minted && (
        <PublishedRecord
          key={`${connectionId}:${minted.domain}`}
          record={minted}
          canManage={canManage}
          organizationId={organizationId}
          connectionId={connectionId}
          onProved={() => {
            setPending({ domain: minted.domain, kind: "proof" });
            onChanged?.();
          }}
        />
      )}

      {pending && (
        <Text as="output" color="fg.muted" fontSize="sm" data-testid="connection-domain-pending">
          {PENDING_DOMAIN_WORDS[pending.kind]}
        </Text>
      )}
    </SettingsCard>
  );
}

function DomainTableRow({
  row,
  canManage,
  organizationId,
  connectionId,
  provesWithLicense,
  recordIssued,
  onMinted,
  onChanged,
  onRemovalAccepted,
}: {
  row: DomainRow;
  canManage: boolean;
  organizationId: string;
  connectionId: string;
  provesWithLicense: boolean;
  recordIssued: boolean;
  onMinted: (record: SsoIssuedDnsRecord) => void;
  onChanged?: () => void;
  /** The removal landed; the row stands until the read says otherwise. */
  onRemovalAccepted: () => void;
}) {
  const claim = ssoApi.ssoSetup.claimDomain.useMutation();
  const prove = ssoApi.ssoSetup.proveDomain.useMutation();
  const remove = ssoApi.ssoSetup.removeDomain.useMutation();
  const target = { organizationId, connectionId, domain: row.domain };
  const chip = domainProofChipFor(row);
  const next = domainNextStepFor({
    proved: row.proved,
    proofState: row.proofState,
    claim: row.claim,
    provesWithLicense,
    recordIssued,
  });

  const takeNextStep = () => {
    if (next.kind === "claim-again") {
      claim.mutate(target, {
        onSuccess: () => onChanged?.(),
      });

      return;
    }

    prove.mutate(target, {
      onSuccess: (proof) => {
        if (!proof.proved) onMinted(proof.record);
        onChanged?.();
      },
    });
  };

  return (
    <Table.Row data-testid="connection-domain-row">
      <Table.Cell verticalAlign="top">{row.domain}</Table.Cell>
      <Table.Cell verticalAlign="top">
        <VStack align="start" gap={1}>
          <DomainStatusChip {...chip} />
          <Text fontSize="xs" color="fg.muted" maxWidth="52ch">
            {next.explanation}
          </Text>
          {/* The reviewer's own words, so a second attempt starts from what
              a person here already said. */}
          {row.claim?.note && (
            <Text fontSize="sm" color="fg.muted">
              {row.claim.note}
            </Text>
          )}
          <InlineRefusal
            error={claim.error ?? prove.error ?? remove.error}
            what={`That step on ${row.domain}`}
          />
        </VStack>
      </Table.Cell>
      <Table.Cell verticalAlign="top">
        <HStack gap={1} justify="end">
          {canManage && next.action && (
            <Button
              size="sm"
              colorPalette={next.kind === "claim-again" ? "gray" : "orange"}
              variant={next.kind === "claim-again" ? "outline" : "solid"}
              loading={prove.isPending || claim.isPending}
              onClick={takeNextStep}
            >
              {next.action}
            </Button>
          )}
          {/* The way back out, quiet beside the way forward. Removing a
              proved domain from a connection that is deciding sign-in is
              refused by the server, naming what leaves instead. */}
          {canManage && (
            <Button
              size="xs"
              variant="ghost"
              color="fg.muted"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(target, {
                  onSuccess: () => {
                    onRemovalAccepted();
                    onChanged?.();
                  },
                })
              }
            >
              Remove
            </Button>
          )}
        </HStack>
      </Table.Cell>
    </Table.Row>
  );
}

/**
 * The five facts and nothing else: what kind of record, where it goes, and
 * what goes in it — beside the file that proves the same domain for anybody
 * whose DNS is a ticket away. Either one finishes the ceremony.
 */
function PublishedRecord({
  record,
  canManage,
  organizationId,
  connectionId,
  onProved,
}: {
  record: SsoIssuedDnsRecord;
  canManage: boolean;
  organizationId: string;
  connectionId: string;
  onProved: () => void;
}) {
  const checkRecord = ssoApi.ssoSetup.checkDomainRecord.useMutation();
  const checkFile = ssoApi.ssoSetup.checkDomainFile.useMutation();
  const target = { organizationId, connectionId, domain: record.domain };
  const settled = { onSuccess: () => onProved() };

  return (
    <VStack align="stretch" gap={2} data-testid="connection-domain-record">
      <Text fontSize="sm">
        Publish this for{" "}
        <Text as="span" fontFamily="mono">
          {record.domain}
        </Text>
        , then ask us to look for it. We show the value once.
      </Text>
      <CopyValueRow label="Record type" value={record.type} />
      <CopyValueRow label="Name" value={record.name} />
      <CopyValueRow label="Value" value={record.value} />
      <CopyValueRow label="Or this file" value={record.file.path} />
      <CopyValueRow label="Served at" value={record.file.url} />
      {canManage && (
        <HStack gap={2}>
          <Button
            size="sm"
            loading={checkRecord.isPending}
            onClick={() => checkRecord.mutate(target, settled)}
          >
            Check for it now
          </Button>
          <Button
            size="sm"
            variant="outline"
            loading={checkFile.isPending}
            onClick={() => checkFile.mutate(target, settled)}
          >
            Check the file instead
          </Button>
        </HStack>
      )}
      {/* The verdict, where the reader is looking. A check that found nothing
          is the commonest thing to happen here, and it must say so rather than
          appear to do nothing. */}
      <InlineRefusal
        error={checkRecord.error ?? checkFile.error}
        what={`Checking ${record.domain}`}
      />
    </VStack>
  );
}

/**
 * Why anybody is being asked to edit DNS at all. Saying it is optional is
 * the point: read as mandatory, somebody stops here and the connection they
 * registered never goes live. What skipping it costs is named, not implied.
 */
function WhyADomainIsProved({ provesWithLicense }: { provesWithLicense: boolean }) {
  if (provesWithLicense) {
    return (
      <Text color="fg.muted" fontSize="sm" maxWidth="72ch">
        A domain has to be proved before it decides how people sign in. On this installation your
        enterprise licence is that proof, so there is nothing to publish anywhere.
      </Text>
    );
  }

  return (
    <VStack align="stretch" gap={1}>
      <Text color="fg.muted" fontSize="sm" maxWidth="72ch">
        Proving a domain is optional, and you can come back to it at any time — your account manager
        at LangWatch can also do it for you. You publish a short value we give you in the
        domain&apos;s DNS, or as a file on your website, and we look for it.
      </Text>
      <Text color="fg.muted" fontSize="sm" maxWidth="72ch">
        Until a domain is proved, people sign in through the link you give them rather than being
        recognised by their email address — so nobody is sent to your identity provider on their
        own.
      </Text>
    </VStack>
  );
}
