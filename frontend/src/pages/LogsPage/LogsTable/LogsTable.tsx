import { ApolloError } from '@apollo/client'
import { Button } from '@components/Button'
import { AdditionalFeedResults } from '@components/FeedResults/FeedResults'
import { Link } from '@components/Link'
import LoadingBox from '@components/LoadingBox'
import {
	Box,
	Callout,
	IconSolidCheveronDown,
	IconSolidCheveronRight,
	Stack,
	Table,
	Text,
} from '@highlight-run/ui/components'
import { FullScreenContainer } from '@pages/LogsPage/LogsTable/FullScreenContainer'
import { LogLevel } from '@pages/LogsPage/LogsTable/LogLevel'
import { LogMessage } from '@pages/LogsPage/LogsTable/LogMessage'
import { LogTimestamp } from '@pages/LogsPage/LogsTable/LogTimestamp'
import { NoLogsFound } from '@pages/LogsPage/LogsTable/NoLogsFound'
import { LogEdgeWithError } from '@pages/LogsPage/useGetLogs'
import {
	createColumnHelper,
	ExpandedState,
	flexRender,
	getCoreRowModel,
	getExpandedRowModel,
	useReactTable,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import React, { Key, useEffect, useRef, useState } from 'react'

import { SearchExpression } from '@/components/Search/Parser/listener'
import { parseSearch } from '@/components/Search/utils'
import { LogEdge } from '@/graph/generated/schemas'
import { findMatchingLogAttributes } from '@/pages/LogsPage/utils'

import { LogDetails, LogValue } from './LogDetails'
import * as styles from './LogsTable.css'

type Props = {
	loading: boolean
	error: ApolloError | undefined
	refetch: () => void
} & LogsTableInnerProps

export const LogsTable = (props: Props) => {
	if (props.loading) {
		return (
			<FullScreenContainer>
				<LoadingBox />
			</FullScreenContainer>
		)
	}

	if (props.error) {
		return (
			<FullScreenContainer>
				<Box m="auto" style={{ maxWidth: 300 }}>
					<Callout title="Failed to load logs" kind="error">
						<Box mb="6">
							<Text color="moderate">
								There was an error loading your logs. Reach out
								to us if this might be a bug.
							</Text>
						</Box>
						<Stack direction="row">
							<Button
								kind="secondary"
								trackingId="logs-error-reload"
								onClick={() => props.refetch()}
							>
								Reload query
							</Button>
							<Box
								display="flex"
								alignItems="center"
								justifyContent="center"
							>
								<Link
									to="https://highlight.io/community"
									target="_blank"
								>
									Help
								</Link>
							</Box>
						</Stack>
					</Callout>
				</Box>
			</FullScreenContainer>
		)
	}

	if (props.logEdges.length === 0) {
		return (
			<FullScreenContainer>
				<NoLogsFound />
			</FullScreenContainer>
		)
	}

	return <LogsTableInner {...props} />
}

type LogsTableInnerProps = {
	loadingAfter: boolean
	logEdges: LogEdgeWithError[]
	query: string
	selectedCursor: string | undefined
	fetchMoreWhenScrolled: (target: HTMLDivElement) => void
	// necessary for loading most recent loads
	moreLogs?: number
	bodyHeight: string
	clearMoreLogs?: () => void
	handleAdditionalLogsDateChange?: () => void
}

const LOADING_AFTER_HEIGHT = 28

const GRID_COLUMNS = ['32px', '175px', '75px', '1fr']

const LogsTableInner = ({
	logEdges,
	loadingAfter,
	query,
	selectedCursor,
	moreLogs,
	bodyHeight,
	clearMoreLogs,
	handleAdditionalLogsDateChange,
	fetchMoreWhenScrolled,
}: LogsTableInnerProps) => {
	const bodyRef = useRef<HTMLDivElement>(null)
	const enableFetchMoreLogs =
		!!moreLogs && !!clearMoreLogs && !!handleAdditionalLogsDateChange

	const { queryParts } = parseSearch(query)
	const [expanded, setExpanded] = useState<ExpandedState>({})

	const columnHelper = createColumnHelper<LogEdge>()

	const columns = [
		columnHelper.accessor('cursor', {
			cell: ({ row }) => {
				return (
					<Box flexShrink={0} display="flex">
						{row.getIsExpanded() ? (
							<IconExpanded />
						) : (
							<IconCollapsed />
						)}
					</Box>
				)
			},
		}),
		columnHelper.accessor('node.timestamp', {
			cell: ({ getValue }) => (
				<Box pt="2">
					<LogTimestamp timestamp={getValue()} />
				</Box>
			),
		}),
		columnHelper.accessor('node.level', {
			cell: ({ getValue }) => (
				<Box pt="2">
					<LogLevel level={getValue()} />
				</Box>
			),
		}),
		columnHelper.accessor('node.message', {
			cell: ({ row, getValue }) => {
				const rowExpanded = row.getIsExpanded()

				return (
					<Stack gap="2" pt="2">
						<LogMessage
							queryParts={queryParts}
							message={getValue()}
							expanded={rowExpanded}
						/>
					</Stack>
				)
			},
		}),
	]

	const table = useReactTable({
		data: logEdges,
		columns,
		state: {
			expanded,
		},
		onExpandedChange: setExpanded,
		getRowCanExpand: (row) => row.original.node.logAttributes,
		getCoreRowModel: getCoreRowModel(),
		getExpandedRowModel: getExpandedRowModel(),
	})

	const { rows } = table.getRowModel()

	const rowVirtualizer = useVirtualizer({
		count: rows.length,
		estimateSize: () => 29,
		getScrollElement: () => bodyRef.current,
		overscan: 50,
	})

	const totalSize = rowVirtualizer.getTotalSize()
	const virtualRows = rowVirtualizer.getVirtualItems()
	const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start || 0 : 0
	let paddingBottom =
		virtualRows.length > 0
			? totalSize - (virtualRows[virtualRows.length - 1]?.end || 0)
			: 0

	if (!loadingAfter) {
		paddingBottom += LOADING_AFTER_HEIGHT
	}

	useEffect(() => {
		// Collapse all rows when search changes
		table.toggleAllRowsExpanded(false)
	}, [query, table])

	useEffect(() => {
		const foundRow = rows.find(
			(row) => row.original.cursor === selectedCursor,
		)

		if (foundRow) {
			rowVirtualizer.scrollToIndex(foundRow.index, {
				align: 'start',
				behavior: 'smooth',
			})
			foundRow.toggleExpanded(true)
		}

		// Only run when the component mounts
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	useEffect(() => {
		setTimeout(() => {
			if (!loadingAfter && bodyRef?.current) {
				fetchMoreWhenScrolled(bodyRef.current)
			}
		}, 0)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [loadingAfter])

	const handleFetchMoreWhenScrolled = (
		e: React.UIEvent<HTMLDivElement, UIEvent>,
	) => {
		setTimeout(() => {
			fetchMoreWhenScrolled(e.target as HTMLDivElement)
		}, 0)
	}

	return (
		<Table height="full" noBorder>
			<Table.Head>
				<Table.Row gridColumns={GRID_COLUMNS}>
					<Table.Header />
					<Table.Header>Timestamp</Table.Header>
					<Table.Header>Level</Table.Header>
					<Table.Header>Body</Table.Header>
				</Table.Row>
				{enableFetchMoreLogs && (
					<Table.Row>
						<Box width="full">
							<AdditionalFeedResults
								more={moreLogs}
								type="logs"
								onClick={() => {
									clearMoreLogs()
									handleAdditionalLogsDateChange()
								}}
							/>
						</Box>
					</Table.Row>
				)}
			</Table.Head>
			<Table.Body
				ref={bodyRef}
				overflowY="auto"
				style={{ height: bodyHeight }}
				onScroll={handleFetchMoreWhenScrolled}
			>
				{paddingTop > 0 && <Box style={{ height: paddingTop }} />}
				{virtualRows.map((virtualRow) => {
					const row = rows[virtualRow.index]

					return (
						<LogsTableRow
							key={virtualRow.key}
							row={row}
							rowVirtualizer={rowVirtualizer}
							expanded={row.getIsExpanded()}
							virtualRowKey={virtualRow.key}
							queryParts={queryParts}
						/>
					)
				})}
				{paddingBottom > 0 && <Box style={{ height: paddingBottom }} />}

				{loadingAfter && (
					<Box
						style={{
							height: `${LOADING_AFTER_HEIGHT}px`,
						}}
					>
						<LoadingBox />
					</Box>
				)}
			</Table.Body>
		</Table>
	)
}

export const IconExpanded: React.FC = () => (
	<IconSolidCheveronDown color="#6F6E77" size="12" />
)

export const IconCollapsed: React.FC = () => (
	<IconSolidCheveronRight color="#6F6E77" size="12" />
)

type LogsTableRowProps = {
	row: any
	rowVirtualizer: any
	expanded: boolean
	virtualRowKey: Key
	queryParts: SearchExpression[]
}

const LogsTableRow = React.memo<LogsTableRowProps>(
	({ row, rowVirtualizer, expanded, virtualRowKey, queryParts }) => {
		const attributesRow = (row: any) => {
			const log = row.original.node
			const rowExpanded = row.getIsExpanded()

			const matchedAttributes = findMatchingLogAttributes(queryParts, {
				...log.logAttributes,
				environment: log.environment,
				level: log.level,
				message: log.message,
				secure_session_id: log.secureSessionID,
				service_name: log.serviceName,
				service_version: log.serviceVersion,
				source: log.source,
				span_id: log.spanID,
				trace_id: log.traceID,
			})
			const hasAttributes = Object.entries(matchedAttributes).length > 0

			return (
				<Table.Row selected={expanded} className={styles.attributesRow}>
					{(rowExpanded || hasAttributes) && (
						<Table.Cell py="4" pl="32">
							{!rowExpanded && (
								<Box>
									{Object.entries(matchedAttributes).map(
										([key, { match, value }]) => {
											return (
												<LogValue
													key={key}
													label={key}
													value={value}
													queryKey={key}
													queryMatch={match}
													queryParts={queryParts}
												/>
											)
										},
									)}
								</Box>
							)}
							<LogDetails
								matchedAttributes={matchedAttributes}
								row={row}
								queryParts={queryParts}
							/>
						</Table.Cell>
					)}
				</Table.Row>
			)
		}

		return (
			<div
				key={virtualRowKey}
				data-index={virtualRowKey}
				ref={rowVirtualizer.measureElement}
			>
				<Table.Row
					gridColumns={GRID_COLUMNS}
					onClick={row.getToggleExpandedHandler()}
					selected={expanded}
					className={styles.dataRow}
				>
					{row.getVisibleCells().map((cell: any) => {
						return (
							<Table.Cell
								key={cell.column.id}
								alignItems="flex-start"
							>
								{flexRender(
									cell.column.columnDef.cell,
									cell.getContext(),
								)}
							</Table.Cell>
						)
					})}
				</Table.Row>
				{attributesRow(row)}
			</div>
		)
	},
	(prevProps, nextProps) => {
		return (
			prevProps.expanded === nextProps.expanded &&
			prevProps.virtualRowKey === nextProps.virtualRowKey
		)
	},
)
