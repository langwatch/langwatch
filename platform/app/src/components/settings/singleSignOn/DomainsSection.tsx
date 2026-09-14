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
  SelfServeIssuedDnsRecord,
  SelfServeSetupView,
} from "@langwatch/identity-server";
import { Check, KeyRound, RefreshCw } from "lucide-react";
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
  /**
   * THE VALUE, HELD WHERE IT CAN BE READ.
   *
   * It is minted by the command that issues the record and returned ONCE —
   * the fact keeps only a hash, so no later read can answer it. The screen
   * used to throw that answer away and then render the record from the
   * refetched setup, where `value` is forever null, so the one string the
   * whole ceremony depends on appeared nowhere at all and the page calmly
   * explained it had been "shown once" without ever having shown it.
   *
   * Kept in state rather than pushed anywhere: it is a secret whose whole
   * lifetime is this screen, and a reload is meant to lose it.
   *
   * The WHOLE record, not only the value. The panel that publishes it was
   * drawn from the read alone, and on the first prove the read has no record
   * to give — so the press minted a value, stored it, and rendered nothing at
   * all. It looked like the button did nothing, and pressing it again would
   * have minted a second value and quietly retired the first.
   */
  const [minted, setMinted] = useState<SelfServeIssuedDnsRecord | null>(null);
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
  // The read is authoritative once it has one; before then, the record this
  // screen just minted IS the record, and drawing it is the whole visible
  // result of pressing prove. A freshly minted one cannot be expired.
  const shownRecord: SelfServeSetupView["record"] =
    record ?? (minted ? { ...minted, expired: false } : null);

  return (
    <VStack align="stretch" gap={3}>
      <WhyADomainIsProved provesWithLicense={provesWithLicense} />

      {domains.length === 0 ? (
        <Text color="fg.muted" fontSize="sm">
          No domain has been claimed yet. Add the domain your team&apos;s email
          addresses end in —{" "}
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
        // Hairlines, not a filled band. The default header wears a solid
        // fill, which on a three-row table reads as a heavier object than the
        // thing it labels — and the rows underneath it are the content.
        <Table.Root size="sm" variant="line">
          <Table.Header>
            <Table.Row background="transparent">
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
                // Either source. A value minted a moment ago is issued
                // whether or not the read has caught up — and this is what
                // moves the row off "Prove this domain", so pressing it twice
                // cannot mint a second value that retires the first.
                recordIssued={
                  record?.domain === entry || minted?.domain === entry
                }
                onMinted={setMinted}
              />
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {canManage && (
        <VStack align="stretch" gap={2}>
          {/* Both at their own height, aligned on the centre line. The button
              used to be stretched to match the field — `height="auto"` inside
              an `align="stretch"` row — which made a control twice as tall as
              any other button on the page and flattened its label against the
              top of it. */}
          <HStack align="center">
            <Input
              placeholder="Domain, for example acme.com"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
            />
            <Button
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

      {shownRecord !== null && (
        <PublishedRecord
          record={shownRecord}
          canManage={canManage}
          organizationId={organizationId}
          connectionId={connectionId}
          minted={minted?.domain === shownRecord.domain ? minted.value : null}
          onMinted={setMinted}
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
  recordIssued,
  // DECLARED IN THE TYPE AND NEVER TAKEN OFF THE PROPS, which made every
  // successful mint throw a ReferenceError on the line that was supposed to
  // keep its value. The mint had already happened server-side, so the row
  // moved on after a reload and the value — issued once and never returned
  // again — was gone, and the only way to see one was to press a second time
  // and replace the record nobody had seen. This is why "Prove this domain"
  // looked like it did nothing.
  onMinted,
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
  /** Whether a value is already out for this domain, waiting to be
   *  published. Asking to prove again would replace it. */
  recordIssued: boolean;
  /** Where a freshly minted record goes. Returned once and never again, so
   *  a caller that ignores it has thrown the ceremony's answer away. */
  onMinted: (minted: SelfServeIssuedDnsRecord) => void;
}) {
  const keepMintedValue = (
    result:
      | { proved: true }
      | { proved: false; record: SelfServeIssuedDnsRecord },
  ) => {
    if (!result.proved) onMinted(result.record);
  };
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
    recordIssued,
  });

  // AWAITED, not fired and forgotten. An un-awaited invalidate lets the
  // mutation finish — spinner off, row re-rendered — while the refetch is
  // still in flight, so the screen settles on the state it already had and
  // only a manual reload shows what happened. It looked like the button
  // worked "sometimes", which is the shape of a race rather than a bug in
  // the step itself. Awaiting keeps the control busy until the answer is in.
  const settle = {
    onSuccess: async () => {
      await utils.ssoSetup.getSetup.invalidate();
    },
  };
  const target = { organizationId, connectionId, domain };
  // "Claim it again" is a claim; every other move on this row asks to prove.
  const takeNextStep = () =>
    next.kind === "claim-again"
      ? claim.mutate(target, settle)
      : prove.mutate(target, {
          ...settle,
          // The value is in THIS response and in no later read, so keeping
          // it is the difference between showing it and telling somebody it
          // was already shown.
          onSuccess: (result) => {
            keepMintedValue(result);
            settle.onSuccess();
          },
        });

  return (
    <Table.Row>
      <Table.Cell verticalAlign="top">{domain}</Table.Cell>
      <Table.Cell verticalAlign="top">
        <VStack align="start" gap={1}>
          <IdentityChip
            label={chip.label}
            tone={chip.tone}
            title={chip.title}
            // A settled domain is the one state somebody scans this table
            // for, and green alone is a channel some readers do not have.
            icon={chip.tone === "good" ? <Check size={12} /> : undefined}
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
          {/* THE ONE THING TO DO ON THIS ROW, dressed like it. It was a grey
              extra-small chip sitting beside "Remove", which read as a pair of
              equals — and the row exists to move somebody forward, not to
              offer them a symmetrical choice between proceeding and undoing.
              "Claim it again" stays quieter: it is a retry after a rejection
              rather than the step somebody came here to take. */}
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
          Anybody could type{" "}
          <Text as="span" fontFamily="mono">
            acme.com
          </Text>{" "}
          into this box, so proving it means showing us something only its owner
          could put there.
        </Text>
        <Text>
          DNS is the public address book for a domain — the same place its
          website and email records are set. It is not in LangWatch: it lives
          with whoever administers the domain, usually a registrar or DNS host
          such as Cloudflare, Route 53 or GoDaddy, and often another team. The
          record we ask for is a plain public one. It grants nothing, it is
          visible to anyone who looks, and it can be deleted once the connection
          is retired.
        </Text>
        <Text>
          If DNS is a ticket away, you can serve the same value as a file on the
          website instead. Either one proves the domain.
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
        // The summary is the one interactive line in a quiet block, so it
        // wears the brand accent — set here because nothing above it carries
        // a palette, and a bare `colorPalette.*` reference would silently
        // fall through to the theme's default one.
        colorPalette="orange"
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
  minted,
  onMinted,
}: {
  /** The value as this screen last saw it minted, which is the ONLY place it
   *  exists — a refetched record carries a hash and a null value. */
  minted: string | null;
  onMinted: (minted: SelfServeIssuedDnsRecord) => void;
  record: NonNullable<SelfServeSetupView["record"]>;
  canManage: boolean;
  organizationId: string;
  connectionId: string;
}) {
  const check = api.ssoSetup.checkDomainRecord.useMutation();
  const checkFile = api.ssoSetup.checkDomainFile.useMutation();
  const prove = api.ssoSetup.proveDomain.useMutation();
  const utils = api.useUtils();
  const [replacing, setReplacing] = useState(false);
  // The freshly minted value wins: after a replace, the read's null (or a
  // previous value) must never be what the reader publishes.
  const shownValue = minted ?? record.value;

  const target = { organizationId, connectionId, domain: record.domain };
  // Awaited for the reason the row's is — see `DomainRow`. This is the one
  // the checks run through, and a check whose refetch lost the race is a
  // check that appears to have found nothing.
  const settle = {
    onSuccess: async () => {
      await utils.ssoSetup.getSetup.invalidate();
    },
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
          // `record.value` comes back null on every read after the mint, so
          // the value shown is the one this screen caught when it was
          // issued. Rendering the row from the read alone is what made the
          // secret invisible on the very screen that issued it.
          ...(shownValue === null
            ? []
            : [
                {
                  label: "Value",
                  hint: "Shown once — this is the secret",
                  value: shownValue,
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
      {/* Only once the screen has genuinely lost it — a reload, or a value
          minted in another tab. Saying this while the value is on screen
          above was the old bug read back as copy. */}
      {shownValue === null && (
        <Text color="fg.muted" fontSize="sm">
          The value was shown once, when the record was issued, and we keep only
          a hash of it. If you no longer have it, ask for a fresh one below and
          publish that instead.
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
            {/* NOT A RETRY, THOUGH IT SITS BESIDE TWO. It mints a new value
                and the old one stops counting, so pressing it after
                publishing quietly makes the record in somebody's DNS console
                the wrong one — with nothing on screen having said so. It
                asks first, and the question names the consequence. */}
            {replacing ? (
              <HStack gap={2}>
                <Button
                  colorPalette="orange"
                  loading={prove.isPending}
                  onClick={() => {
                    setReplacing(false);
                    prove.mutate(target, {
                      ...settle,
                      onSuccess: (result) => {
                        if (!result.proved) onMinted(result.record);
                        settle.onSuccess();
                      },
                    });
                  }}
                >
                  Yes, replace it
                </Button>
                <Button
                  variant="ghost"
                  disabled={prove.isPending}
                  onClick={() => setReplacing(false)}
                >
                  Keep the current value
                </Button>
              </HStack>
            ) : (
              // A CONTROL, drawn as one. As a ghost button it read as a stray
              // line of prose beside two real buttons, so what it was — and
              // that it could be pressed at all — was left to be guessed. The
              // label names the noun it replaces rather than asking for "a
              // fresh value" of something unstated.
              <Button
                variant="outline"
                color="fg.muted"
                onClick={() => setReplacing(true)}
              >
                <KeyRound size={14} />
                Replace the secret value
              </Button>
            )}
          </HStack>
          {replacing && (
            <Text fontSize="sm" color="fg.muted" maxWidth="72ch">
              A fresh value replaces the one above, and anything you have
              already published stops counting — you would need to publish the
              new value in its place. Only do this if the current value has been
              lost or has expired.
            </Text>
          )}
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
