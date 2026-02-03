import {
	Box,
	Button,
	Field,
	Heading,
	HStack,
	Input,
	Skeleton,
	Spacer,
	Tag,
	Text,
	useDisclosure,
	VStack,
} from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import cloneDeep from "lodash-es/cloneDeep";
import numeral from "numeral";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, X } from "react-feather";
import { Search } from "lucide-react";
import { LuZap } from "react-icons/lu";
import { useDebounceValue } from "usehooks-ts";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { type FilterParam, useFilterParams } from "../../hooks/useFilterParams";
import { filterOutEmptyFilters } from "../../server/analytics/utils";
import type { AppRouter } from "../../server/api/root";
import { availableFilters } from "../../server/filters/registry";
import type { FilterDefinition, FilterField } from "../../server/filters/types";
import { api } from "../../utils/api";
import { OverflownTextWithTooltip } from "../OverflownText";
import { Checkbox } from "../ui/checkbox";
import { useColorRawValue } from "../ui/color-mode";
import { InputGroup } from "../ui/input-group";
import { Popover } from "../ui/popover";
import { Slider } from "../ui/slider";
import { Tooltip } from "../ui/tooltip";

export function QueryStringFieldsFilters({
	hideTriggerButton = false,
}: {
	hideTriggerButton?: boolean;
}) {
	const { nonEmptyFilters, setFilters } = useFilterParams();

	const { openDrawer } = useDrawer();
	const { hasPermission } = useOrganizationTeamProject();

	const hasAnyFilters = Object.keys(nonEmptyFilters).length > 0;

	return (
		<FieldsFilters
			filters={nonEmptyFilters}
			setFilters={(filters) => setFilters(filterOutEmptyFilters(filters))}
			actionButton={
				hasPermission("triggers:manage") && !hideTriggerButton ? (
					<Tooltip content="Create a filter to add a trigger.">
						<Button
							colorPalette="gray"
							onClick={() => openDrawer("trigger", undefined)}
							disabled={!hasAnyFilters}
						>
							<LuZap />
							Add Trigger
						</Button>
					</Tooltip>
				) : undefined
			}
		/>
	);
}

export function FieldsFilters({
	filters,
	setFilters,
	actionButton,
}: {
	filters: Record<FilterField, FilterParam>;
	setFilters: (filters: Partial<Record<FilterField, FilterParam>>) => void;
	actionButton?: React.ReactNode;
}) {
	const filterKeys: FilterField[] = [
		"metadata.prompt_ids",
		"spans.model",
		"metadata.labels",
		"evaluations.passed",
		"evaluations.score",
		"evaluations.label",
		"events.metrics.value",
		"metadata.user_id",
		"metadata.thread_id",
		"metadata.customer_id",
		"metadata.value",
		"evaluations.state",
		"traces.error",
		"annotations.hasAnnotation",
	];

	const allFilters: [FilterField, FilterDefinition][] = filterKeys.map((id) => [
		id,
		availableFilters[id],
	]);

	return (
		<VStack align="start" width="300px" gap={4}>
			<HStack width={"full"}>
				<Heading fontSize="sm">Filters</Heading>

				<Spacer />

				{actionButton}
			</HStack>
			<VStack gap={3} width="full">
				{allFilters.map(([id, filter]) => (
					<FieldsFilter
						key={id}
						filterId={id}
						filter={filter}
						filters={filters}
						setFilters={setFilters}
					/>
				))}
			</VStack>
		</VStack>
	);
}

// Filter types that should NOT allow custom values
const BOOLEAN_FILTER_IDS: FilterField[] = [
	"evaluations.passed",
	"traces.error",
	"annotations.hasAnnotation",
	"evaluations.state",
];

function FieldsFilter({
	filterId,
	filter,
	filters,
	setFilters,
}: {
	filterId: FilterField;
	filter: FilterDefinition;
	filters: Record<FilterField, FilterParam>;
	setFilters: (filters: Partial<Record<FilterField, FilterParam>>) => void;
}) {
	const gray400 = useColorRawValue("gray.400");

	const setFilter = useCallback(
		(filterId: FilterField, values: FilterParam) => {
			setFilters({ ...filters, [filterId]: values });
		},
		[setFilters, filters],
	);

	const searchRef = React.useRef<HTMLInputElement | null>(null);
	const [query, setQuery] = useDebounceValue("", 300);
	const [immediateQuery, setImmediateQuery] = useState("");
	const { open, setOpen } = useDisclosure();
	const current = filters[filterId] ?? [];

	// Keyboard navigation state
	const [highlightedIndex, setHighlightedIndex] = useState(-1);
	const [isKeyboardNav, setIsKeyboardNav] = useState(false);
	const [optionCount, setOptionCount] = useState(0);

	// Ref for selecting the highlighted option from keyboard
	const selectHighlightedRef = React.useRef<(() => void) | null>(null);

	// Reset keyboard nav state when popover closes
	useEffect(() => {
		if (!open) {
			setHighlightedIndex(-1);
			setIsKeyboardNav(false);
		}
	}, [open]);

	const currentStringList = Array.isArray(current)
		? current
		: Object.keys(current);

	const allowCustomValue =
		filter.type !== "numeric" && !BOOLEAN_FILTER_IDS.includes(filterId);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setIsKeyboardNav(true);
				setHighlightedIndex((prev) => Math.min(prev + 1, optionCount - 1));
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				setIsKeyboardNav(true);
				setHighlightedIndex((prev) => Math.max(prev - 1, 0));
			} else if (e.key === "Enter") {
				e.preventDefault();
				selectHighlightedRef.current?.();
			} else if (e.key === "Escape") {
				e.preventDefault();
				setOpen(false);
			}
		},
		[optionCount, setOpen],
	);

	return (
		<Field.Root>
			<Popover.Root
				positioning={{ placement: "bottom" }}
				open={open}
				onOpenChange={({ open }) => setOpen(open)}
			>
				<Popover.Trigger asChild>
					<Button
						variant="subtle"
						backgroundColor="bg.muted"
						size="sm"
						width="100%"
						fontWeight="normal"
					>
						<HStack width="full" gap={1}>
							<Text color="fg.muted" fontWeight="500" paddingRight={4}>
								{filter.name}
							</Text>
							{currentStringList.length > 0 ? (
								<>
									<Text lineClamp={1}>{currentStringList.join(", ")}</Text>
									<Spacer />
									{currentStringList.length > 1 && (
										<Tag.Root
											justifyContent="center"
											display="flex"
											flexShrink={0}
										>
											<Tag.Label>{currentStringList.length}</Tag.Label>
										</Tag.Root>
									)}
									<Tooltip
										content={`Clear ${filter.name.toLowerCase()} filter`}
									>
										<Button
											as={Box}
											role="button"
											variant="ghost"
											width="fit-content"
											display="flex"
											onClick={(e) => {
												e.stopPropagation();
												setFilter(filterId, []);
											}}
										>
											<X />
										</Button>
									</Tooltip>
								</>
							) : (
								<>
									<Text color="fg.subtle">Any</Text>
									<Spacer />
								</>
							)}
							<ChevronDown />
						</HStack>
					</Button>
				</Popover.Trigger>
				<Popover.Content padding={0}>
					<Box
						position="sticky"
						top={0}
						zIndex="1"
						borderBottom="1px solid"
						borderColor="border"
					>
						<InputGroup
							width="full"
							startElement={<Search size={14} color={gray400} />}
							startElementProps={{ paddingStart: "4px" }}
							paddingY={1}
							paddingX={2}
						>
							<Input
								variant={"plain" as any}
								size="sm"
								placeholder="Search..."
								ref={searchRef}
								onChange={(e) => {
									setQuery(e.target.value);
									setImmediateQuery(e.target.value);
									setHighlightedIndex(-1);
								}}
								onKeyDown={handleKeyDown}
							/>
						</InputGroup>
					</Box>
					<Popover.Body paddingY={1} paddingX={0}>
						{open && (
							<NestedListSelection
								query={query}
								immediateQuery={immediateQuery}
								current={current}
								keysAhead={[
									...(filter.requiresKey ? [filter.requiresKey.filter] : []),
									...(filter.requiresSubkey
										? [filter.requiresSubkey.filter]
										: []),
									filterId,
								]}
								paddingX={4}
								setFilter={setFilter}
								allowCustomValue={allowCustomValue}
								highlightedIndex={highlightedIndex}
								onHighlightChange={setHighlightedIndex}
								isKeyboardNav={isKeyboardNav}
								onKeyboardNavChange={setIsKeyboardNav}
								onOptionCountChange={setOptionCount}
								selectHighlightedRef={selectHighlightedRef}
							/>
						)}
					</Popover.Body>
				</Popover.Content>
			</Popover.Root>
		</Field.Root>
	);
}

function NestedListSelection({
	query,
	immediateQuery,
	current,
	keysAhead,
	keysBefore = [],
	paddingX = 0,
	setFilter,
	allowCustomValue = false,
	highlightedIndex,
	onHighlightChange,
	isKeyboardNav,
	onKeyboardNavChange,
	onOptionCountChange,
	selectHighlightedRef,
}: {
	query: string;
	immediateQuery?: string;
	current: FilterParam;
	keysAhead: FilterField[];
	keysBefore?: string[];
	paddingX?: number;
	setFilter: (filterId: FilterField, values: FilterParam) => void;
	allowCustomValue?: boolean;
	highlightedIndex?: number;
	onHighlightChange?: (index: number) => void;
	isKeyboardNav?: boolean;
	onKeyboardNavChange?: (isKeyboard: boolean) => void;
	onOptionCountChange?: (count: number) => void;
	selectHighlightedRef?: React.MutableRefObject<(() => void) | null>;
}) {
	const filterId = keysAhead[0];
	if (!filterId) {
		console.warn("NestedListSelection called with empty keysAhead");
		return null;
	}

	let currentValues = current;
	keysBefore.forEach((key) => {
		if (!Array.isArray(currentValues)) {
			currentValues = currentValues[key] ?? [];
		}
	});
	if (!Array.isArray(currentValues)) {
		currentValues = Object.keys(currentValues);
	}

	return (
		<ListSelection
			filterId={filterId}
			query={query}
			immediateQuery={immediateQuery}
			currentValues={currentValues}
			keys={keysBefore}
			onChange={(values) => {
				const topLevelFilterId = keysAhead[keysAhead.length - 1]!;
				if (keysAhead.length === 1 && keysBefore.length == 0) {
					setFilter(topLevelFilterId, values);
					return;
				}

				const filterParam = Array.isArray(current) ? {} : cloneDeep(current);
				let current_ = filterParam;
				keysBefore
					.slice(0, keysAhead.length + keysBefore.length - 2)
					.forEach((key) => {
						const next = current_[key];
						if (next) {
							if (Array.isArray(next)) {
								current_[key] = {} as Record<string, string[]>;
								current_ = current_[key] as any;
							} else {
								current_ = next;
							}
						}
					});

				const lastKey = keysBefore[keysBefore.length - 1]!;
				if (keysAhead.length === 1) {
					current_[lastKey] = values;
				} else {
					for (const key of Object.keys(current_)) {
						if (!(key in values)) {
							delete current_[key];
						}
					}
					for (const key of values) {
						if (!current_[key]) {
							current_[key] = [];
						}
					}
					if (lastKey && Object.keys(current_).length === 0) {
						current_[lastKey] = [];
					}
				}

				setFilter(topLevelFilterId, filterParam);
			}}
			{...(keysAhead.length > 1
				? {
						nested: (key) => {
							return (
								<NestedListSelection
									query=""
									immediateQuery=""
									current={current}
									keysAhead={keysAhead.slice(1)}
									keysBefore={[...keysBefore, key]}
									setFilter={setFilter}
								/>
							);
						},
					}
				: {})}
			paddingX={paddingX}
			allowCustomValue={allowCustomValue}
			highlightedIndex={highlightedIndex}
			onHighlightChange={onHighlightChange}
			isKeyboardNav={isKeyboardNav}
			onKeyboardNavChange={onKeyboardNavChange}
			onOptionCountChange={onOptionCountChange}
			selectHighlightedRef={selectHighlightedRef}
		/>
	);
}

function ListSelection({
	filterId,
	query,
	immediateQuery,
	keys,
	currentValues,
	onChange,
	nested,
	paddingX = 0,
	allowCustomValue = false,
	highlightedIndex = -1,
	onHighlightChange,
	isKeyboardNav = false,
	onKeyboardNavChange,
	onOptionCountChange,
	selectHighlightedRef,
}: {
	filterId: FilterField;
	query: string;
	immediateQuery?: string;
	keys?: string[];
	currentValues: string[];
	onChange: (value: string[]) => void;
	nested?: (key: string) => React.ReactNode;
	paddingX?: number;
	allowCustomValue?: boolean;
	highlightedIndex?: number;
	onHighlightChange?: (index: number) => void;
	isKeyboardNav?: boolean;
	onKeyboardNavChange?: (isKeyboard: boolean) => void;
	onOptionCountChange?: (count: number) => void;
	selectHighlightedRef?: React.MutableRefObject<(() => void) | null>;
}) {
	const filter = availableFilters[filterId];

	const { filterParams, queryOpts } = useFilterParams();
	const filterData = api.analytics.dataForFilter.useQuery(
		{
			...filterParams,
			field: filterId,
			key: keys?.[0],
			subkey: keys?.[1],
		},
		{
			refetchOnMount: false,
			refetchOnWindowFocus: false,
			keepPreviousData: true,
			enabled: queryOpts.enabled,
		},
	);

	const options = useMemo(() => {
		const sortingFn = (a: { count: number }, b: { count: number }) =>
			a.count > b.count ? -1 : 1;

		if (query) {
			return filterData.data?.options
				.filter((option) => {
					return option.label.toLowerCase().includes(query.toLowerCase());
				})
				.toSorted(sortingFn);
		}

		return filterData.data?.options.toSorted(sortingFn);
	}, [filterData.data?.options, query]);

	// Use immediateQuery for custom value display (no debounce delay)
	const customValueQuery = (immediateQuery ?? query).trim();

	// Check if we should show custom value option
	const hasExactMatch = useMemo(() => {
		if (!customValueQuery || !options) return true;
		return options.some(
			(opt) => opt.label.toLowerCase() === customValueQuery.toLowerCase(),
		);
	}, [options, customValueQuery]);

	const showCustomValue =
		allowCustomValue && customValueQuery && !hasExactMatch;

	// Calculate total option count (options + custom value if shown)
	const totalOptionCount = (options?.length ?? 0) + (showCustomValue ? 1 : 0);

	// Notify parent of option count changes
	useEffect(() => {
		onOptionCountChange?.(totalOptionCount);
	}, [totalOptionCount, onOptionCountChange]);

	const parentRef = React.useRef<HTMLDivElement>(null);

	const virtualizer = useVirtualizer({
		count: options?.length ?? 0,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 36,
		gap: 0,
		overscan: 5,
	});

	const isEmpty = options && options.length === 0 && !showCustomValue;

	// Handle selecting custom value
	const handleCustomValueSelect = useCallback(() => {
		if (!customValueQuery) return;
		if (currentValues.includes(customValueQuery)) {
			onChange(currentValues.filter((v) => v !== customValueQuery));
		} else {
			onChange([...currentValues, customValueQuery]);
		}
	}, [customValueQuery, currentValues, onChange]);

	// Handle selecting an option by index
	const handleSelectByIndex = useCallback(
		(index: number) => {
			if (index < 0) return;

			// If index is the custom value option
			if (showCustomValue && index === (options?.length ?? 0)) {
				handleCustomValueSelect();
				return;
			}

			// Otherwise select from options
			const option = options?.[index];
			if (!option) return;

			const field = option.field.toString();
			if (currentValues.includes(field)) {
				onChange(currentValues.filter((v) => v !== field));
			} else {
				onChange([...currentValues, field]);
			}
		},
		[
			options,
			showCustomValue,
			currentValues,
			onChange,
			handleCustomValueSelect,
		],
	);

	// Set up the ref for keyboard selection
	useEffect(() => {
		if (selectHighlightedRef) {
			selectHighlightedRef.current = () =>
				handleSelectByIndex(highlightedIndex);
		}
		return () => {
			if (selectHighlightedRef) {
				selectHighlightedRef.current = null;
			}
		};
	}, [selectHighlightedRef, handleSelectByIndex, highlightedIndex]);

	// Handle mouse hover on options
	const handleMouseMove = useCallback(
		(index: number) => {
			if (isKeyboardNav || highlightedIndex === index) return;
			onKeyboardNavChange?.(false);
			onHighlightChange?.(index);
		},
		[isKeyboardNav, highlightedIndex, onKeyboardNavChange, onHighlightChange],
	);

	if (
		filter.type === "numeric" &&
		keys?.[0] == "thumbs_up_down" &&
		keys?.[1] == "vote"
	) {
		return (
			<ThumbsUpDownVoteFilter
				currentValues={currentValues}
				onChange={onChange}
			/>
		);
	}

	if (filter.type === "numeric") {
		return (
			<RangeFilter
				filterData={filterData}
				currentValues={currentValues}
				onChange={onChange}
			/>
		);
	}

	const customValueIndex = options?.length ?? 0;

	return (
		<Box
			width="full"
			paddingY={1}
			maxHeight="280px"
			overflowY="auto"
			paddingX={2}
			ref={parentRef}
		>
			<VStack
				width="full"
				align="start"
				gap={0}
				height={
					filterData.isLoading || isEmpty
						? "auto"
						: `${virtualizer.getTotalSize() + (showCustomValue ? 36 : 0)}px`
				}
				position="relative"
			>
				{virtualizer.getVirtualItems().map((virtualItem) => {
					// eslint-disable-next-line prefer-const
					let { field, label, count } = options?.[virtualItem.index] ?? {
						field: "",
						label: "",
						count: 0,
					};
					let details = "";
					const labelDetailsMatch = label.match(/^\[(.*)\] (.*)/);
					if (labelDetailsMatch) {
						label = labelDetailsMatch[2] ?? "";
						details = labelDetailsMatch[1] ?? "";
					}

					const isHighlighted = virtualItem.index === highlightedIndex;

					const onChange_ = (e: any) => {
						e.preventDefault();
						e.stopPropagation();

						if (currentValues.includes(field.toString())) {
							onChange(
								currentValues.filter((v) => v.toString() !== field.toString()),
							);
						} else {
							onChange([...currentValues, field]);
						}
					};

					return (
						<VStack
							key={field}
							width="full"
							gap={0}
							position="absolute"
							top={0}
							left={0}
							transform={`translateY(${virtualItem.start}px)`}
							data-index={virtualItem.index}
							ref={virtualizer.measureElement}
						>
							<HStack
								width="full"
								background={isHighlighted ? "bg.muted" : undefined}
								borderRadius="md"
								paddingX={2}
								onMouseMove={() => handleMouseMove(virtualItem.index)}
							>
								<Checkbox
									width="full"
									paddingY={2}
									gap={2}
									size="sm"
									checked={currentValues.includes(field.toString())}
									onClick={onChange_}
									onChange={onChange_}
								>
									<VStack width="full" align="start" gap={0}>
										{details && (
											<OverflownTextWithTooltip
												fontSize="xs"
												color="fg.muted"
												lineClamp={1}
												wordBreak="break-all"
											>
												{details}
											</OverflownTextWithTooltip>
										)}
										<OverflownTextWithTooltip
											fontSize="sm"
											lineClamp={1}
											wordBreak="break-all"
										>
											{label === "" ? "<empty>" : label}
										</OverflownTextWithTooltip>
									</VStack>
								</Checkbox>
								<Spacer />
								{typeof count !== "undefined" && (
									<Text fontSize="12px" color="fg.subtle">
										{count}
									</Text>
								)}
							</HStack>
							<Box width="full" paddingLeft={4}>
								{nested && currentValues.includes(field) && nested(field)}
							</Box>
						</VStack>
					);
				})}

				{/* Custom value option - shown at bottom when searching */}
				{showCustomValue && (
					<HStack
						width="full"
						position="absolute"
						top={0}
						left={0}
						transform={`translateY(${virtualizer.getTotalSize()}px)`}
						background={
							highlightedIndex === customValueIndex ? "bg.muted" : undefined
						}
						borderRadius="md"
						paddingX={2}
						onMouseMove={() => handleMouseMove(customValueIndex)}
					>
						<Checkbox
							width="full"
							paddingY={2}
							gap={2}
							size="sm"
							checked={currentValues.includes(customValueQuery)}
							onClick={handleCustomValueSelect}
							onChange={handleCustomValueSelect}
						>
							<OverflownTextWithTooltip
								fontSize="sm"
								lineClamp={1}
								wordBreak="break-all"
							>
								{customValueQuery}
							</OverflownTextWithTooltip>
						</Checkbox>
					</HStack>
				)}

				{isEmpty && (
					<Text fontSize="sm" paddingX={1} paddingY={2}>
						No options found
					</Text>
				)}
				{filterData.isLoading &&
					Array.from({ length: keys && keys.length > 0 ? 2 : 5 }).map(
						(_, i) => (
							<HStack key={i} width="full" paddingX={2}>
								<Checkbox
									checked={false}
									paddingY={2}
									gap={2}
									size="sm"
									width="full"
									onChange={() => void 0}
								>
									<Skeleton height="14px" width="100px" />
								</Checkbox>
							</HStack>
						),
					)}
			</VStack>
		</Box>
	);
}

function RangeFilter({
	filterData,
	currentValues,
	onChange,
}: {
	filterData: UseTRPCQueryResult<
		inferRouterOutputs<AppRouter>["analytics"]["dataForFilter"],
		TRPCClientErrorLike<AppRouter>
	>;
	currentValues: string[];
	onChange: (value: string[]) => void;
}) {
	let min = +numeral(
		+(filterData.data?.options.find((o) => o.label === "min")?.field ?? 0),
	).format("0.[0]");
	let max = +numeral(
		+(filterData.data?.options.find((o) => o.label === "max")?.field ?? 0),
	).format("0.[0]");
	if (isNaN(min)) {
		min = 0;
	}
	if (isNaN(max)) {
		max = 1;
	}
	if (min === max && min === 0) {
		min = 0;
		max = 1;
	}
	if (min === max && min !== 0) {
		min = 0;
	}

	useEffect(() => {
		if (filterData.data) {
			onChange([min.toString(), max.toString()]);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [min, max, !!filterData.data]);

	return (
		<HStack width="full" gap={3} paddingX={3} paddingY={2}>
			<Input
				width="56px"
				paddingX={1}
				textAlign="center"
				size="sm"
				value={currentValues[0]}
				onChange={(e) => {
					onChange([e.target.value, currentValues[1] ?? max.toString()]);
				}}
			/>
			<Slider.Root
				width="full"
				min={min}
				max={max}
				step={0.1}
				value={
					currentValues && currentValues.length == 2
						? currentValues?.map((v) => +v)
						: [min, max]
				}
				onValueChange={(values) => {
					onChange(values.value.map((v) => v.toString()));
				}}
				colorPalette="orange"
			>
				<Slider.Control>
					<Slider.Track>
						<Slider.Range />
					</Slider.Track>
					<Slider.Thumb index={0} cursor="grab">
						<Slider.HiddenInput />
					</Slider.Thumb>
					<Slider.Thumb index={1} cursor="grab">
						<Slider.HiddenInput />
					</Slider.Thumb>
				</Slider.Control>
			</Slider.Root>
			<Input
				width="56px"
				paddingX={1}
				textAlign="center"
				size="sm"
				value={currentValues[1]}
				onChange={(e) => {
					onChange([currentValues[0] ?? min.toString(), e.target.value]);
				}}
			/>
		</HStack>
	);
}

function ThumbsUpDownVoteFilter({
	currentValues,
	onChange,
}: {
	currentValues: string[];
	onChange: (value: string[]) => void;
}) {
	const min = currentValues[0] ? +currentValues[0] : undefined;
	const max = currentValues[1] ? +currentValues[1] : undefined;

	return (
		<VStack
			width="full"
			align="start"
			gap={0}
			paddingY={1}
			paddingX={2}
			maxHeight="280px"
			overflowY="auto"
		>
			{[
				{ field: -1, label: "negative" },
				{ field: 1, label: "positive" },
			].map(({ field, label }) => {
				const isChecked = !!(min && max && min <= field && max >= field);
				return (
					<HStack key={field} width="full" paddingX={1}>
						<Checkbox
							width="full"
							paddingY="4px"
							gap={2}
							size="sm"
							checked={isChecked}
							onClick={(e) => {
								e.stopPropagation();
								if (!isChecked) {
									onChange([
										(min && min < field ? min : field).toString(),
										(max && max > field ? max : field).toString(),
									]);
								} else {
									const other = field === -1 ? 1 : -1;
									onChange([
										((min ?? 0) === field && (max ?? 0) === field
											? undefined
											: other
										)?.toString() ?? "",
										((min ?? 0) === field && (max ?? 0) === field
											? undefined
											: other
										)?.toString() ?? "",
									]);
								}
							}}
						>
							<Text fontSize="sm">{label}</Text>
						</Checkbox>
					</HStack>
				);
			})}
		</VStack>
	);
}
