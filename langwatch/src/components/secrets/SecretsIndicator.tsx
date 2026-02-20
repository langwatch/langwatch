import {
	Alert,
	Box,
	Button,
	Code,
	HStack,
	Link,
	Spacer,
	Text,
	VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { LuExternalLink, LuKeyRound, LuSettings } from "react-icons/lu";
import { Popover } from "~/components/ui/popover";
import { api } from "~/utils/api";

interface SecretsIndicatorProps {
	projectId: string;
	onInsertSecret?: (secretName: string) => void;
}

/**
 * Button that reveals a popover listing project secrets.
 * Clicking a secret name inserts `secrets.NAME` at the editor cursor.
 */
export function SecretsIndicator({
	projectId,
	onInsertSecret,
}: SecretsIndicatorProps) {
	const secretsQuery = api.secrets.list.useQuery({ projectId });
	const secrets = secretsQuery.data ?? [];
	const [open, setOpen] = useState(false);

	const handleSecretClick = (secretName: string) => {
		onInsertSecret?.(secretName);
		setOpen(false);
	};

	return (
		<Popover.Root
			open={open}
			onOpenChange={({ open }) => setOpen(open)}
			positioning={{ placement: "bottom-end" }}
		>
			<Popover.Trigger asChild>
				<HStack
					as="button"
					gap={1}
					fontSize="13px"
					color="gray.400"
					cursor="pointer"
					_hover={{ color: "white" }}
					paddingX={2}
					paddingY={1}
					borderRadius="md"
					data-testid="secrets-indicator"
				>
					<LuKeyRound size={14} />
					<Text>Secrets</Text>
				</HStack>
			</Popover.Trigger>
			<Popover.Content
				background="bg.panel"
				borderRadius="lg"
				portalled={false}
				color="fg"
			>
				<Popover.Body padding={0}>
					<VStack align="stretch" gap={0}>
						{/* Header */}
						<HStack paddingX={3} paddingY={2} borderBottomWidth="1px">
							<LuKeyRound size={14} style={{ flexShrink: 0 }} />
							<Text fontSize="sm" fontWeight="medium" textWrap="nowrap">
								Project Secrets
							</Text>
							<Spacer />
							{/* Manage link */}
							{secrets.length > 0 && (
								<Button variant="outline" size="xs" asChild>
									<Link
										href="/settings/secrets"
										target="_blank"
										rel="noopener noreferrer"
										fontSize="xs"
									>
										<LuSettings size={14} />
										Manage secrets
									</Link>
								</Button>
							)}
						</HStack>

						{/* Secret list */}
						<Box maxHeight="200px" overflowY="auto">
							{secrets.length === 0 ? (
								<Box paddingX={3} paddingY={3}>
									<Text fontSize="xs" color="fg.muted">
										No secrets yet.
									</Text>
									<Link
										href="/settings/secrets"
										target="_blank"
										rel="noopener noreferrer"
										fontSize="xs"
										color="blue.500"
									>
										Add secrets in Settings{" "}
										<LuExternalLink
											size={10}
											style={{ display: "inline", verticalAlign: "middle" }}
										/>
									</Link>
								</Box>
							) : (
								secrets.map((secret) => (
									<HStack
										key={secret.id}
										as="button"
										width="full"
										paddingX={3}
										paddingY={1.5}
										_hover={{ bg: "bg.subtle" }}
										cursor="pointer"
										justify="space-between"
										onClick={() => handleSecretClick(secret.name)}
										data-testid={`secret-item-${secret.name}`}
									>
										<Code fontSize="xs">{secret.name}</Code>
									</HStack>
								))
							)}
						</Box>

						{/* Usage hint */}
						<Box padding={2} borderTopWidth="1px">
							<Alert.Root status="info" size="sm" borderRadius="md">
								<Alert.Indicator />
								<Alert.Content>
									<Text fontSize="xs">
										Use <Code fontSize="xs">secrets.NAME</Code> syntax in your
										code
									</Text>
								</Alert.Content>
							</Alert.Root>
						</Box>
					</VStack>
				</Popover.Body>
			</Popover.Content>
		</Popover.Root>
	);
}
