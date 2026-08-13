/*
 * Void, a modification for grok.com
 * Copyright (c) 2026 Void contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type {
    AccordionContentProps, AccordionItemProps, AccordionProps, AccordionTriggerProps,
    AlertDialogContentProps, AlertDialogProps, AvatarProps, BadgeProps, ButtonProps, ButtonWithPopoverProps, ButtonWithTooltipProps,
    CardContentProps, CardHeaderProps, CardProps, CardTitleProps, CheckboxProps,
    CommandEmptyProps, CommandGroupProps, CommandInputProps, CommandItemProps, CommandListProps, CommandProps,
    DialogContentProps, DialogHeaderProps, DialogOverlayProps, DialogPortalProps, DialogProps, DialogTriggerProps,
    DrawerContentProps, DrawerDescriptionProps, DrawerFooterProps, DrawerHeaderProps, DrawerProps, DrawerTitleProps, DrawerTriggerProps,
    DropdownMenuCheckboxItemProps, DropdownMenuContentProps, DropdownMenuItemProps, DropdownMenuPortalProps,
    DropdownMenuProps, DropdownMenuRadioGroupProps, DropdownMenuRadioItemProps, DropdownMenuSeparatorProps,
    DropdownMenuSubContentProps, DropdownMenuSubProps, DropdownMenuSubTriggerProps, DropdownMenuTriggerProps,
    HoverCardContentProps, HoverCardProps, HoverCardTriggerProps,
    InputProps, LabelProps, MotionProps,
    PopoverArrowProps, PopoverContentProps, PopoverProps, PopoverTriggerProps, PortalProps,
    RadixSubProps, ResponsiveDialogProps,
    SelectContentProps, SelectItemProps, SelectProps, SelectTriggerProps, SelectValueProps,
    SeparatorProps, SettingsDescriptionProps, SettingsRowProps, SettingsTitleProps,
    SkeletonProps, SliderProps, SpinnerProps, SwitchProps,
    TableBodyProps, TableCellProps, TableHeaderProps, TableHeadProps, TableProps, TableRowProps,
    TabsContentProps, TabsListProps, TabsProps, TabsTriggerProps, TextareaProps,
    TooltipContentProps, TooltipProps, TooltipProviderProps, TooltipTriggerProps,
} from "@grok-types";
import type { ComponentType, ReactNode } from "react";

import { filters, findByProps, findByPropsLazy, findExportedComponent, waitFor } from "../turbopack";
import { type AnyComponent, createElement, LazyComponent } from "./react";
import { getSettingsPrimitive } from "./settingsPrimitives";

export type * from "@grok-types";

function createModuleLazy(...filterProps: string[]) {
    let mod: Record<string, ComponentType> | null = null;
    waitFor(filters.byProps(...filterProps), m => { mod = m; });
    return <P = {}>(name: string): ComponentType<P> =>
        LazyComponent(name, () => (mod?.[name] ?? findExportedComponent(name)) as AnyComponent | null) as unknown as ComponentType<P>;
}

function lazyExport<P = {}>(name: string): ComponentType<P> {
    return LazyComponent(name, () => findExportedComponent(name)) as unknown as ComponentType<P>;
}

const buttonLazy = createModuleLazy("Button", "ButtonWithPopover");
export const Button = buttonLazy<ButtonProps>("Button");
export const ButtonWithTooltip = buttonLazy<ButtonWithTooltipProps>("ButtonWithTooltip");
export const ButtonWithTooltipOptimized = buttonLazy<ButtonWithTooltipProps>("ButtonWithTooltipOptimized");
export const ButtonWithPopover = buttonLazy<ButtonWithPopoverProps>("ButtonWithPopover");

const cardLazy = createModuleLazy("Card", "CardContent", "CardHeader", "CardTitle");
export const Card = cardLazy<CardProps>("Card");
export const CardContent = cardLazy<CardContentProps>("CardContent");
export const CardHeader = cardLazy<CardHeaderProps>("CardHeader");
export const CardTitle = cardLazy<CardTitleProps>("CardTitle");

const dialogLazy = createModuleLazy("Dialog", "DialogContent", "DialogHeader");
export const Dialog = dialogLazy<DialogProps>("Dialog");
export const DialogContent = dialogLazy<DialogContentProps>("DialogContent");
export const DialogHeader = dialogLazy<DialogHeaderProps>("DialogHeader");
export const DialogTitle = dialogLazy<RadixSubProps>("DialogTitle");
export const DialogDescription = dialogLazy<RadixSubProps>("DialogDescription");
export const DialogFooter = dialogLazy<RadixSubProps>("DialogFooter");
export const DialogClose = dialogLazy<RadixSubProps>("DialogClose");
export const DialogTrigger = dialogLazy<DialogTriggerProps>("DialogTrigger");
export const DialogOverlay = dialogLazy<DialogOverlayProps>("DialogOverlay");
export const DialogPortal = dialogLazy<DialogPortalProps>("DialogPortal");

const drawerLazy = createModuleLazy("Drawer", "DrawerContent", "DrawerTrigger");
export const Drawer = drawerLazy<DrawerProps>("Drawer");
export const DrawerContent = drawerLazy<DrawerContentProps>("DrawerContent");
export const DrawerTrigger = drawerLazy<DrawerTriggerProps>("DrawerTrigger");
export const DrawerDescription = drawerLazy<DrawerDescriptionProps>("DrawerDescription");
export const DrawerFooter = drawerLazy<DrawerFooterProps>("DrawerFooter");
export const DrawerHeader = drawerLazy<DrawerHeaderProps>("DrawerHeader");
export const DrawerTitle = drawerLazy<DrawerTitleProps>("DrawerTitle");
export const ResponsiveDialog = drawerLazy<ResponsiveDialogProps>("ResponsiveDialog");

const dropdownMenuLazy = createModuleLazy("DropdownMenu", "DropdownMenuContent", "DropdownMenuTrigger");
export const DropdownMenu = dropdownMenuLazy<DropdownMenuProps>("DropdownMenu");
export const DropdownMenuTrigger = dropdownMenuLazy<DropdownMenuTriggerProps>("DropdownMenuTrigger");
export const DropdownMenuContent = dropdownMenuLazy<DropdownMenuContentProps>("DropdownMenuContent");
export const DropdownMenuItem = dropdownMenuLazy<DropdownMenuItemProps>("DropdownMenuItem");
export const DropdownMenuCheckboxItem = dropdownMenuLazy<DropdownMenuCheckboxItemProps>("DropdownMenuCheckboxItem");
export const DropdownMenuRadioGroup = dropdownMenuLazy<DropdownMenuRadioGroupProps>("DropdownMenuRadioGroup");
export const DropdownMenuRadioItem = dropdownMenuLazy<DropdownMenuRadioItemProps>("DropdownMenuRadioItem");
export const DropdownMenuSeparator = dropdownMenuLazy<DropdownMenuSeparatorProps>("DropdownMenuSeparator");
export const DropdownMenuSub = dropdownMenuLazy<DropdownMenuSubProps>("DropdownMenuSub");
export const DropdownMenuSubTrigger = dropdownMenuLazy<DropdownMenuSubTriggerProps>("DropdownMenuSubTrigger");
export const DropdownMenuSubContent = dropdownMenuLazy<DropdownMenuSubContentProps>("DropdownMenuSubContent");
export const DropdownMenuPortal = dropdownMenuLazy<DropdownMenuPortalProps>("DropdownMenuPortal");

const hoverCardLazy = createModuleLazy("HoverCard", "HoverCardContent", "HoverCardTrigger");
export const HoverCard = hoverCardLazy<HoverCardProps>("HoverCard");
export const HoverCardContent = hoverCardLazy<HoverCardContentProps>("HoverCardContent");
export const HoverCardTrigger = hoverCardLazy<HoverCardTriggerProps>("HoverCardTrigger");

export const Input = lazyExport<InputProps>("Input");
export const Label = lazyExport<LabelProps>("Label");
export const MotionDiv: ComponentType<MotionProps> = LazyComponent("MotionDiv", () => findByProps("motion")?.motion?.div);
export const Portal = lazyExport<PortalProps>("Portal");

const selectLazy = createModuleLazy("Select", "SelectContent", "SelectTrigger");
export const Select = selectLazy<SelectProps>("Select");
export const SelectTrigger = selectLazy<SelectTriggerProps>("SelectTrigger");
export const SelectContent = selectLazy<SelectContentProps>("SelectContent");
export const SelectItem = selectLazy<SelectItemProps>("SelectItem");
export const SelectValue = selectLazy<SelectValueProps>("SelectValue");

export const Separator = lazyExport<SeparatorProps>("Separator");

const FallbackSettingsRow = ({ children, action, hidden, className }: SettingsRowProps) => hidden ? null : createElement("div", { className: ["flex items-center justify-between gap-4 px-3 py-2", className].filter(Boolean).join(" ") }, createElement("div", { className: "min-w-0 flex-1" }, children), action);
const FallbackSettingsTitle = ({ children, className }: SettingsTitleProps) => createElement("div", { className: ["text-sm font-medium text-fg-primary", className].filter(Boolean).join(" ") }, children);
const FallbackSettingsDescription = ({ children }: SettingsDescriptionProps) => createElement("div", { className: "mt-0.5 text-xs text-fg-secondary" }, children as ReactNode);

export const SettingsRow = LazyComponent("SettingsRow", () => (getSettingsPrimitive("SettingsRow") ?? FallbackSettingsRow) as AnyComponent) as unknown as ComponentType<SettingsRowProps>;
export const SettingsTitle = LazyComponent("SettingsTitle", () => (getSettingsPrimitive("SettingsTitle") ?? FallbackSettingsTitle) as AnyComponent) as unknown as ComponentType<SettingsTitleProps>;
export const SettingsDescription = LazyComponent("SettingsDescription", () => (getSettingsPrimitive("SettingsDescription") ?? FallbackSettingsDescription) as AnyComponent) as unknown as ComponentType<SettingsDescriptionProps>;

export const Skeleton = lazyExport<SkeletonProps>("Skeleton");
export const Slider = lazyExport<SliderProps>("Slider");
export const Switch = lazyExport<SwitchProps>("Switch");

const tableLazy = createModuleLazy("Table", "TableBody", "TableCell");
export const Table = tableLazy<TableProps>("Table");
export const TableBody = tableLazy<TableBodyProps>("TableBody");
export const TableCell = tableLazy<TableCellProps>("TableCell");
export const TableHead = tableLazy<TableHeadProps>("TableHead");
export const TableHeader = tableLazy<TableHeaderProps>("TableHeader");
export const TableRow = tableLazy<TableRowProps>("TableRow");

const tooltipLazy = createModuleLazy("Tooltip", "TooltipTrigger", "TooltipContent");
export const Tooltip = tooltipLazy<TooltipProps>("Tooltip");
export const TooltipTrigger = tooltipLazy<TooltipTriggerProps>("TooltipTrigger");
export const TooltipContent = tooltipLazy<TooltipContentProps>("TooltipContent");
export const TooltipProvider = tooltipLazy<TooltipProviderProps>("TooltipProvider");

export const Textarea = lazyExport<TextareaProps>("Textarea");
export const Checkbox = lazyExport<CheckboxProps>("Checkbox");
export const Spinner = lazyExport<SpinnerProps>("Spinner");
export const Avatar = lazyExport<AvatarProps>("Avatar");

const popoverLazy = createModuleLazy("Popover", "PopoverContent", "PopoverTrigger");
export const Popover = popoverLazy<PopoverProps>("Popover");
export const PopoverTrigger = popoverLazy<PopoverTriggerProps>("PopoverTrigger");
export const PopoverContent = popoverLazy<PopoverContentProps>("PopoverContent");
export const PopoverArrow = popoverLazy<PopoverArrowProps>("PopoverArrow");

const tabsLazy = createModuleLazy("Tabs", "TabsList", "TabsTrigger", "TabsContent");
export const Tabs = tabsLazy<TabsProps>("Tabs");
export const TabsList = tabsLazy<TabsListProps>("TabsList");
export const TabsTrigger = tabsLazy<TabsTriggerProps>("TabsTrigger");
export const TabsContent = tabsLazy<TabsContentProps>("TabsContent");

const accordionLazy = createModuleLazy("Accordion", "AccordionContent", "AccordionItem");
export const Accordion = accordionLazy<AccordionProps>("Accordion");
export const AccordionItem = accordionLazy<AccordionItemProps>("AccordionItem");
export const AccordionTrigger = accordionLazy<AccordionTriggerProps>("AccordionTrigger");
export const AccordionContent = accordionLazy<AccordionContentProps>("AccordionContent");

const commandLazy = createModuleLazy("Command", "CommandInput", "CommandList", "CommandItem");
export const Command = commandLazy<CommandProps>("Command");
export const CommandInput = commandLazy<CommandInputProps>("CommandInput");
export const CommandList = commandLazy<CommandListProps>("CommandList");
export const CommandItem = commandLazy<CommandItemProps>("CommandItem");
export const CommandGroup = commandLazy<CommandGroupProps>("CommandGroup");
export const CommandEmpty = commandLazy<CommandEmptyProps>("CommandEmpty");

export const Badge = lazyExport<BadgeProps>("Badge");

const alertDialogLazy = createModuleLazy("AlertDialog", "AlertDialogContent", "AlertDialogAction");
export const AlertDialog = alertDialogLazy<AlertDialogProps>("AlertDialog");
export const AlertDialogTrigger = alertDialogLazy<RadixSubProps>("AlertDialogTrigger");
export const AlertDialogContent = alertDialogLazy<AlertDialogContentProps>("AlertDialogContent");
export const AlertDialogHeader = alertDialogLazy<RadixSubProps>("AlertDialogHeader");
export const AlertDialogFooter = alertDialogLazy<RadixSubProps>("AlertDialogFooter");
export const AlertDialogTitle = alertDialogLazy<RadixSubProps>("AlertDialogTitle");
export const AlertDialogDescription = alertDialogLazy<RadixSubProps>("AlertDialogDescription");
export const AlertDialogAction = alertDialogLazy<RadixSubProps>("AlertDialogAction");
export const AlertDialogCancel = alertDialogLazy<RadixSubProps>("AlertDialogCancel");

const toggleGroupLazy = createModuleLazy("ToggleGroup", "ToggleGroupItem");
export const ToggleGroup = toggleGroupLazy<RadixSubProps>("ToggleGroup");
export const ToggleGroupItem = toggleGroupLazy<RadixSubProps>("ToggleGroupItem");

export const SidebarComponents = findByPropsLazy("Sidebar", "SidebarContent", "SidebarProvider");
export const AnimatePresence = lazyExport("AnimatePresence");
