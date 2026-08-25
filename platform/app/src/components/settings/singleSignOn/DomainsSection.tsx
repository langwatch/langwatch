import {
  Alert,
  Box,
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
import { RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { domainNextStepFor } from "~/features/sso/logic/domainNextStep";
import { domainProofChipFor } from "~/features/sso/logic/domainProofChip";
import { api } from "../../../utils/api";
import { IdentityChip } from "../../access/IdentityRow";
import { CopyValueRows } from "../CopyValueRows";
import { InlineRefusal } from "./refusals";

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
      <WhyADomainIsProved provesWithLicense={provesWithLicense} />

      {domains.length === 0 ? (
        <Text color="fg.muted" fontSize="sm">
          No domain has been claimed yet. Add the domain your team&apos;s email
          addresses end in — <Text as="span" fontFamily="mono">acme.com</Text>{" "}
          for somebody signing in as{" "}
          <Text as="span" fontFamily="mono">jane@acme.com</Text>.
        </Text>
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
            {domains.map((entry) => (
              <DomainRow
                key={entry}
                domain={entry}
                claimed={claims.find((candidate) => candidate.domain === entry)}
                proved={proved.has(entry)}
                proof={proofByDomain.get(entry)}
                canManage={canManage}
                organizationId={organizationId}
                connectionId={connectionId}
                provesWithLicense={provesWithLicense}
              />
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {canManage && (
        <VStack align="stretch" gap={2}>
          <HStack align="stretch">
            <Input
              placeholder="Domain, for example acme.com"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
            />
            <Button
              height="auto"
              flexShrink={0}
              loading={claim.isPending}
              onClick={() =>
                claim.mutate(
                  { organizationId, connectionId, domain },
                  {
                    onSuccess: () => {
                      setDomain("");
                      void utils.ssoSetup.getSetup.invalidate();
                    },
                  },
                )
              }
            >
              Claim domain
            </Button>
          </HStack>
          <InlineRefusal error={claim.error} what="Claiming that domain" />
        </VStack>
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

function DomainRow({
  domain,
  claimed,
  proved,
  proof,
  canManage,
  organizationId,
  connectionId,
  provesWithLicense,
}: {
  domain: string;
  claimed: SelfServeDomainClaimView | undefined;
  proved: boolean;
  proof:
    | NonNullable<SelfServeSetupView["connection"]>["domainProofs"][number]
    | undefined;
  canManage: boolean;
  organizationId: string;
  connectionId: string;
  provesWithLicense: boolean;
}) {
  const claim = api.ssoSetup.claimDomain.useMutation();
  const prove = api.ssoSetup.proveDomain.useMutation();
  const remove = api.ssoSetup.removeDomain.useMutation();
  const utils = api.useUtils();
  const chip = domainProofChipFor({
    proved,
    proofState: proof?.proofState ?? "VERIFIED",
    graceEndsAtMs: proof?.graceEndsAtMs ?? null,
    claim: claimed,
  });
  const next = domainNextStepFor({
    proved,
    proofState: proof?.proofState ?? "VERIFIED",
    claim: claimed,
    provesWithLicense,
  });

  const settle = {
    onSuccess: () => void utils.ssoSetup.getSetup.invalidate(),
  };
  const target = { organizationId, connectionId, domain };
  // "Claim it again" is a claim; every other move on this row asks to prove.
  const takeNextStep = () =>
    next.kind === "claim-again"
      ? claim.mutate(target, settle)
      : prove.mutate(target, settle);

  return (
    <Table.Row>
      <Table.Cell verticalAlign="top">{domain}</Table.Cell>
      <Table.Cell verticalAlign="top">
        <VStack align="start" gap={1}>
          <IdentityChip
            label={chip.label}
            tone={chip.tone}
            title={chip.title}
          />
          {/* WHAT HAPPENS NEXT, IN WORDS. A chip is a label, not an
              instruction, and this row's whole job is to move somebody
              along. Every state answers it, including the two whose
              answer is "wait". */}
          <Text fontSize="xs" color="fg.muted" maxWidth="52ch">
            {next.explanation}
          </Text>
          {/* The reviewer's own words, read back so a second attempt starts
              from what a human already said. */}
          {claimed?.note && (
            <Text fontSize="sm" color="fg.muted">
              {claimed.note}
            </Text>
          )}
          <InlineRefusal
            error={claim.error ?? prove.error ?? remove.error}
            what={`That step on ${domain}`}
          />
        </VStack>
      </Table.Cell>
      <Table.Cell verticalAlign="top">
        <HStack gap={1} justify="end">
          {canManage && next.action && (
            <Button
              size="xs"
              variant={next.kind === "claim-again" ? "outline" : "solid"}
              loading={prove.isPending || claim.isPending}
              onClick={takeNextStep}
            >
              {next.action}
            </Button>
          )}
          {/* The way back out, quiet beside the way forward. The server
              refuses removing a verified domain from a live connection with
              copy naming the alternative, so the dangerous case never goes
              through this button. */}
          {canManage && (
            <Button
              size="xs"
              variant="ghost"
              color="fg.muted"
              _hover={{ color: "red.solid" }}
              loading={remove.isPending}
              onClick={() => remove.mutate(target, settle)}
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
 * Why anybody is being asked to edit DNS at all — one line on screen, the
 * rest a click away.
 *
 * TWO FAILURES, AND THE SECOND WAS MINE. The screen used to skip straight to
 * the value: a record type, a name, a secret, "publish it", and a retry
 * button — perfectly clear to somebody who had done it before and opaque to
 * everybody else. Explaining it in full then made the opposite mistake, and
 * buried the four things a reader needs under several hundred words they only
 * need once. The teaching goes behind a disclosure, where the person who
 * needs it can find it and the person who does not never sees it.
 */
function WhyADomainIsProved({
  provesWithLicense,
}: {
  provesWithLicense: boolean;
}) {
  if (provesWithLicense) {
    return (
      <Text color="fg.muted" fontSize="sm" maxWidth="72ch">
        A domain has to be proved before it decides how people sign in. On this
        installation your enterprise licence is that proof, so there is nothing
        to publish anywhere.
      </Text>
    );
  }
  return (
    <VStack align="stretch" gap={1}>
      <Text color="fg.muted" fontSize="sm" maxWidth="72ch">
        A domain has to be proved before it decides how people sign in. You
        publish a short value we give you in the domain&apos;s DNS, and we look
        for it.
      </Text>
      <Disclosure summary="What is a DNS record, and who can add one?">
        <Text>
          Anybody could type <Text as="span" fontFamily="mono">acme.com</Text>{" "}
          into this box, so proving it means showing us something only its
          owner could put there.
        </Text>
        <Text>
          DNS is the public address book for a domain — the same place its
          website and email records are set. It is not in LangWatch: it lives
          with whoever administers the domain, usually a registrar or DNS host
          such as Cloudflare, Route 53 or GoDaddy, and often another team. The
          record we ask for is a plain public one. It grants nothing, it is
          visible to anyone who looks, and it can be deleted once the
          connection is retired.
        </Text>
        <Text>
          If DNS is a ticket away, you can serve the same value as a file on
          the website instead. Either one proves the domain.
        </Text>
      </Disclosure>
    </VStack>
  );
}

/**
 * The long answer, folded away.
 *
 * A native `details` rather than a component with state: it is one line of
 * markup, it is keyboard- and screen-reader-correct without any help, and
 * nothing about it needs to survive a re-render.
 */
function Disclosure({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  return (
    <Box as="details" fontSize="sm" color="fg.muted" maxWidth="72ch">
      <Box
        as="summary"
        cursor="pointer"
        color="colorPalette.fg"
        _hover={{ textDecoration: "underline" }}
      >
        {summary}
      </Box>
      <VStack align="stretch" gap={2} paddingTop={2}>
        {children}
      </VStack>
    </Box>
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
  const checkFile = api.ssoSetup.checkDomainFile.useMutation();
  const prove = api.ssoSetup.proveDomain.useMutation();
  const utils = api.useUtils();

  const target = { organizationId, connectionId, domain: record.domain };
  const settle = {
    onSuccess: () => void utils.ssoSetup.getSetup.invalidate(),
  };

  return (
    <VStack align="stretch" gap={3} paddingTop={2}>
      <VStack align="stretch" gap={2}>
        <Heading size="xs">Publish this on {record.domain}</Heading>
        <Text color="fg.muted" fontSize="sm" maxWidth="72ch">
          Add it wherever {record.domain}&apos;s DNS is administered, then come
          back and check.
        </Text>
      </VStack>
      {/* THE FIVE FACTS AND NOTHING ELSE: what kind of record, where it
          goes, and what goes in it. Everything a reader needed once is
          folded below. */}
      <CopyValueRows
        rows={[
          { label: "Type", value: record.type },
          {
            label: "Name",
            hint: "The whole name",
            value: record.name,
          },
          ...(record.value === null
            ? []
            : [
                {
                  label: "Value",
                  hint: "Shown once — this is the secret",
                  value: record.value,
                },
              ]),
        ]}
      />
      <Disclosure summary="My DNS provider wants something different, or I have no DNS access">
        <Text>
          Some providers ask for the label alone rather than the whole name.
          Yours is{" "}
          <Text as="span" fontFamily="mono" color="fg">
            {record.label}
          </Text>
          .
        </Text>
        <Text>
          No DNS access? Serve the value as the entire body of a plain-text
          file, over https, at this address instead — either one proves the
          domain.
        </Text>
        <CopyValueRows
          rows={[{ label: "File address", value: record.file.url }]}
        />
        <Text>
          New records take a few minutes to travel, occasionally up to an hour.
          If the first check does not find it, that is usually all it is.
        </Text>
      </Disclosure>
      {/* The value is shown once, when it is issued. What is kept is its
          hash, so a reload shows the record rather than the secret. */}
      {record.value === null && (
        <Text color="fg.muted" fontSize="sm">
          The value was shown once, when the record was issued. If you no longer
          have it, ask for a fresh record below.
        </Text>
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
        <VStack align="stretch" gap={2}>
          <HStack flexWrap="wrap">
            <Button
              loading={check.isPending}
              onClick={() => check.mutate(target, settle)}
            >
              <RefreshCw size={14} />
              Check for the record
            </Button>
            <Button
              variant="outline"
              loading={checkFile.isPending}
              onClick={() => checkFile.mutate(target, settle)}
            >
              <RefreshCw size={14} />
              Check for the file
            </Button>
            <Button
              variant="ghost"
              loading={prove.isPending}
              onClick={() => prove.mutate(target, settle)}
            >
              Give me a fresh value
            </Button>
          </HStack>
          {/* The check's verdict, where the reader is looking. A check that
              found nothing is the single most common thing to happen here,
              and it must say so rather than appearing to do nothing. */}
          <InlineRefusal
            error={check.error ?? checkFile.error ?? prove.error}
            what={`Checking ${record.domain}`}
          />
        </VStack>
      )}
    </VStack>
  );
}
