import clsx from 'clsx'
import React, { forwardRef } from 'react'

import { Box, BoxProps } from '../Box/Box'
import { Body } from './Body/Body'
import { Cell } from './Cell/Cell'
import { Discoverable } from './Discoverable/Discoverable'
import { FullRow } from './FullRow/FullRow'
import { Head } from './Head/Head'
import { Header } from './Header/Header'
import { Row } from './Row/Row'
import { Search } from './Search/Search'
import * as styles from './styles.css'

type Props = {
	children: React.ReactNode
	className?: string
	height?: BoxProps['height']
	noBorder?: boolean
	withSearch?: boolean
}

const TableComponent = forwardRef<HTMLDivElement, Props>(
	({ children, className, height, noBorder, withSearch }, ref) => {
		return (
			<Box
				cssClass={clsx(styles.table, className, {
					[styles.noBorder]: noBorder,
					[styles.withSearch]: withSearch,
				})}
				height={height}
				width="full"
				ref={ref}
			>
				{children}
			</Box>
		)
	},
)

type TableWithComponents = typeof TableComponent & {
	Body: typeof Body
	Cell: typeof Cell
	Discoverable: typeof Discoverable
	FullRow: typeof FullRow
	Head: typeof Head
	Header: typeof Header
	Row: typeof Row
	Search: typeof Search
}

const Table = TableComponent as TableWithComponents

Table.Body = Body
Table.Cell = Cell
Table.Discoverable = Discoverable
Table.FullRow = FullRow
Table.Head = Head
Table.Header = Header
Table.Row = Row
Table.Search = Search

export { Table }
