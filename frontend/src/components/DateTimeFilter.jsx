import React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { options } from "@/lib/data"
import { Button } from "@/components/ui/button"
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover"
import {
	Command,
	CommandItem,
	CommandList,
} from "@/components/ui/command"

const DateTimeFilter = ({ value: controlledValue, onValueChange, dateQuery, setDateQuery }) => {
	const [open, setOpen] = React.useState(false)
	const [uncontrolledValue, setUncontrolledValue] = React.useState("all")

	const value = controlledValue ?? uncontrolledValue
	const setValue = (nextValue) => {
		if (controlledValue === undefined) {
			setUncontrolledValue(nextValue)
		}
		onValueChange?.(nextValue)
	}

	const selectedLabel = React.useMemo(() => {
		return options.find((o) => o.value === value)?.label ?? "all"
	}, [value])

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					size="lg"
					type="button"
					variant="outline"					 
					role="combobox"
					aria-expanded={open}
					className=""
				>
					{
						dateQuery 
						? options.find((option) => option.value === dateQuery)?.label
						: options[0].label		
					}
					<ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>

			<PopoverContent className="w-[200px] p-0" align="end">
				<Command>
					<CommandList>
						{options.map((opt) => (
							<CommandItem
								key={opt.value}
								value={opt.value}
								onSelect={(currentValue) => {
									setDateQuery(currentValue)
									setValue(currentValue)
									setOpen(false)
								}}
							>
								<Check
									className={cn(
										"mr-2 size-4",
										dateQuery === opt.value ? "opacity-100" : "opacity-0"
									)}
								/>
								<span className="capitalize">{opt.label}</span>
							</CommandItem>
						))}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	)
}

export default DateTimeFilter
